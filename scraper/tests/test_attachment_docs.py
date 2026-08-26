"""
test_attachment_docs.py — Which order documents reach the portal's Attachment
section, in which container, under which Attachment Type.

Pure logic only (no browser). Two halves:

  1. order_to_payload's doc-key split — ID documents to `id_doc_keys`, the IM
     Conversation to `im_doc_keys`, and EVERYTHING else (the combined PDF,
     utility bills, any future app-side type) to `other_doc_keys`, so a new
     type is uploaded rather than silently dropped (which is what happened to
     every non-id/im document before 2026-08-26).
  2. attachment_plan — container keys start at "2" (container 1 is the locked
     IM slot, filled with the FIRST non-ID document before the plan runs), ID
     copies come first, and every further non-ID document is labelled
     "IM Conversation" — never "Others" (live order 2608000122524500 left the
     starred required IM slot empty while the combined PDF sat in an Others
     container; user's call 2026-08-26).

Run from the scraper/ dir:
    pytest tests/test_attachment_docs.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import attachment_plan  # noqa: E402
from order_to_payload import order_to_payload  # noqa: E402


def _payload_for(docs):
    return order_to_payload({
        "fullName": "TEST CUSTOMER",
        "idType": "mykad",
        "idNumber": "900101-10-1234",
        "mobile": "0123456789",
        "email": "t@example.com",
        "street": "1 JALAN TEST",
        "postcode": "40000",
        "city": "SHAH ALAM",
        "state": "Selangor",
        "documents": docs,
    })["customer"]


def test_doc_keys_split_by_type():
    cust = _payload_for([
        {"type": "mykad", "key": "k-mykad"},
        {"type": "passport", "key": "k-passport"},
        {"type": "id", "key": "k-id"},
        {"type": "im_conversation", "key": "k-im"},
        {"type": "utility_bill", "key": "k-utility"},
        {"type": "other", "key": "k-combined"},          # the combined PDF
        {"type": "some_future_type", "key": "k-future"},  # must NOT be dropped
    ])
    assert cust["id_doc_keys"] == ["k-mykad", "k-passport", "k-id"]
    assert cust["im_doc_keys"] == ["k-im"]
    assert cust["other_doc_keys"] == ["k-utility", "k-combined", "k-future"]
    # utility_doc_keys was dead weight (collected, consumed nowhere) — folded
    # into other_doc_keys.
    assert "utility_doc_keys" not in cust


def test_doc_keys_drop_entries_without_key():
    cust = _payload_for([
        {"type": "other"},                 # no key — nothing to download
        {"type": "other", "key": None},
        "not-a-dict",
        {"type": "mykad", "key": "k1"},
    ])
    assert cust["id_doc_keys"] == ["k1"]
    assert cust["other_doc_keys"] == []


def test_doc_keys_empty_documents():
    cust = _payload_for([])
    assert cust["id_doc_keys"] == []
    assert cust["im_doc_keys"] == []
    assert cust["other_doc_keys"] == []


def test_attachment_plan_keys_start_at_2_ids_first():
    plan = attachment_plan(["/tmp/ic.png"], ["/tmp/combined.pdf", "/tmp/bill.pdf"])
    assert plan == [
        ("2", "ID copy", "/tmp/ic.png"),
        ("3", "IM Conversation", "/tmp/combined.pdf"),
        ("4", "IM Conversation", "/tmp/bill.pdf"),
    ]


def test_attachment_plan_never_labels_others():
    # "Others" left the starred required IM slot empty on a live order; every
    # non-ID document is an IM Conversation now.
    plan = attachment_plan(["/tmp/ic.png"], ["/tmp/a.pdf", "/tmp/b.pdf"])
    assert all(label != "Others" for _, label, _ in plan)


def test_attachment_plan_extra_im_only_still_start_at_2():
    # No ID document (bulk-created legacy drafts) — the extra docs must not
    # collide with container 1 (the locked IM slot).
    plan = attachment_plan([], ["/tmp/combined.pdf"])
    assert plan == [("2", "IM Conversation", "/tmp/combined.pdf")]


def test_attachment_plan_empty_and_none():
    assert attachment_plan([], []) == []
    assert attachment_plan(None, None) == []
