"""Delivery address must equal the order's installation address.

The portal's "Default From Billing Address" checkbox prefills the Enter Address
dialog from the billing account. That billing address often differs from the
selected installation unit (existing account, or portal residence prefill).
delivery_terms used to OK that dialog as-is, so delivery and installation
diverged on the submitted order.

These tests pin the pure helper that names the installation address delivery
must copy. They do not drive a live portal.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from delivery_address import (  # noqa: E402
    installation_address_for_delivery,
    overwrite_enter_address_js,
)


# Installation unit the order selected. Deliberately different from a plausible
# billing-account address so a helper that accidentally returned billing would fail.
INSTALL_STREET = "353 LORONG MERPATI 4 TAMAN MERPATI"
INSTALL_POSTCODE = "90000"
INSTALL_CITY = "SANDAKAN"
INSTALL_STATE = "SABAH"

BILLING_STREET = "BLOK 11 LORONG BUKIT SEPANGGAR 1"


def _payload(*, street=INSTALL_STREET, postcode=INSTALL_POSTCODE,
             city=INSTALL_CITY, state=INSTALL_STATE) -> dict:
    return {
        "customer": {
            "name": "UDIN BIN RAUF",
            "residence_street": street,
            "residence_address": f"{street} {postcode} {city} {state}",
            "residence_postcode": postcode,
            "residence_city": city,
            "residence_state": state,
            "residence_country": "Malaysia",
            # A field a confused helper might prefer. Must not win.
            "billing_street": BILLING_STREET,
        },
        "address": {
            "address_full": street,
            "keywords": street,
            "postcode": postcode,
            "state": state,
        },
    }


def test_helper_returns_installation_street_not_billing():
    addr = installation_address_for_delivery(_payload())
    assert addr["street"] == INSTALL_STREET
    assert addr["postcode"] == INSTALL_POSTCODE
    assert addr["city"] == INSTALL_CITY
    assert addr["state"] == INSTALL_STATE
    assert BILLING_STREET not in addr["street"]


def test_helper_prefers_address_full_over_residence_when_both_set():
    """The selected install unit lives on address.address_full."""
    p = _payload()
    p["customer"]["residence_street"] = BILLING_STREET
    p["address"]["address_full"] = INSTALL_STREET
    addr = installation_address_for_delivery(p)
    assert addr["street"] == INSTALL_STREET


def test_helper_collapses_consecutive_spaces_in_street():
    p = _payload(street="353  LORONG   MERPATI  4")
    addr = installation_address_for_delivery(p)
    assert addr["street"] == "353 LORONG MERPATI 4"
    assert "  " not in addr["street"]


def test_helper_empty_street_is_reported():
    p = _payload(street="")
    p["address"]["address_full"] = ""
    p["address"]["keywords"] = ""
    p["customer"]["residence_street"] = ""
    p["customer"]["residence_address"] = ""
    addr = installation_address_for_delivery(p)
    assert addr["street"] == ""


def test_overwrite_js_sets_dialog_fields_from_installation():
    """The evaluate string fills Address + Postcode inside an Enter Address dialog."""
    # Smoke: the exported JS is a function body that references the address keys
    # we pass in. A missing key would mean delivery still OKs billing values.
    js = overwrite_enter_address_js()
    assert "Enter Address" in js
    assert "postcode" in js
    assert "street" in js
    assert "querySelector" in js
