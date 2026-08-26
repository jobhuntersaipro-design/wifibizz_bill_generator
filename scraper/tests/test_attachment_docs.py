"""
test_attachment_docs.py — Which order documents reach the portal's Attachment
section, in which container, under which Attachment Type.

Pure logic only (no browser). Two halves:

  1. order_to_payload's doc-key split — ID documents to `id_doc_keys`, the IM
     Conversation to `im_doc_keys`, and EVERYTHING else (the combined PDF,
     utility bills, any future app-side type) to `other_doc_keys`, so a new
     type is uploaded as "Others" rather than silently dropped (which is what
     happened to every non-id/im document before 2026-08-26).
  2. attachment_plan — container keys start at "2" (container 1 is the locked
     IM slot), ID copies come first, and every other document is labelled
     "Others".

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
        ("3", "Others", "/tmp/combined.pdf"),
        ("4", "Others", "/tmp/bill.pdf"),
    ]


def test_attachment_plan_others_only_still_start_at_2():
    # No ID document (bulk-created legacy drafts) — the other docs must not
    # collide with container 1 (the locked IM slot).
    plan = attachment_plan([], ["/tmp/combined.pdf"])
    assert plan == [("2", "Others", "/tmp/combined.pdf")]


def test_attachment_plan_empty_and_none():
    assert attachment_plan([], []) == []
    assert attachment_plan(None, None) == []
