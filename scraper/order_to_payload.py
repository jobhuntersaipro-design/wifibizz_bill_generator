"""
order_to_payload.py - Transform a BizzFlow `Order` (the agent-keyed form) into an
`enter_order` payload.

This is the respond.io/BizzFlow path (the primary one now): order data comes from
the BizzFlow order form, not a WifiBizz case. It mirrors `case_to_payload.py` but
reads the Order's own fields (idType, idNumber, fullName, gender, birthday, race,
mobilePrefix, mobile, email, street/postcode/city/state, offerName, ...) instead
of deriving everything from a scraped case.

Pure function, no I/O — pass an order dict (camelCase keys as returned by the
Next.js `getOrder`/`listOrders` actions, or snake_case DB columns) and get a
payload back.
"""

import re

# Reuse the shared defaults + helpers so both entry paths agree on the values the
# portal needs but the form doesn't collect.
from case_to_payload import (
    _DEFAULTS,
    _infer_race,
    map_package_to_plan,
    parse_mykad,
)


def _get(order: dict, *keys, default=None):
    """First present key among camelCase/snake_case aliases."""
    for k in keys:
        if order.get(k) not in (None, ""):
            return order[k]
    return default


def _appointment_policy(order: dict) -> dict:
    """The appointment booking policy, accepting either key style.

    BizzFlow sends camelCase (`appointment.leadHours`); a hand-built payload or
    a DB row may use snake_case. Unknown/missing values are left to
    appointment_policy.normalize_policy, which defaults every field.
    """
    appt = _get(order, "appointment", default=None)
    if not isinstance(appt, dict):
        return {}
    return {
        "strategy": appt.get("strategy"),
        "lead_hours": appt.get("leadHours", appt.get("lead_hours")),
        "fixed_date": appt.get("fixedDate", appt.get("fixed_date")),
    }


def order_to_payload(order: dict) -> dict:
    """Build an enter_order payload from a BizzFlow Order dict.

    Deterministic. Fields the form doesn't carry (preferred_language, segment,
    tenure, ...) come from case_to_payload._DEFAULTS. gender/birthday fall back to
    MyKad derivation when the form left them blank. Never raises — emits
    best-effort values so the caller can dry-run and validate.
    """
    id_type = _get(order, "idType", "id_type", default=_DEFAULTS["id_type"])
    id_number_raw = _get(order, "idNumber", "id_number", default="")
    name = _get(order, "fullName", "full_name", default="")
    email = _get(order, "email", default="")
    mobile_prefix = _get(order, "mobilePrefix", "mobile_prefix", default="60")
    mobile = re.sub(r"\D", "", _get(order, "mobile", default="") or "")

    # MyKad-like IDs are digits-only on the portal; passports keep their format.
    mykad_like = str(id_type).lower() in {"mykad", "mykas", "mytentera"}
    id_number = re.sub(r"\D", "", id_number_raw) if mykad_like else id_number_raw

    # Documents (stored in R2). The required portal attachment is the
    # "Customer ID copy" (doctypeid=2) — collect the R2 keys of the identity docs
    # (mykad / passport / legacy "id"). The IM Conversation doc is collected
    # separately for its own portal slot.
    docs = order.get("documents")
    if isinstance(docs, str):
        try:
            import json as _json
            docs = _json.loads(docs)
        except Exception:
            docs = []
    docs = docs or []
    id_doc_keys = [
        d.get("key") for d in docs
        if isinstance(d, dict) and d.get("type") in ("id", "mykad", "passport") and d.get("key")
    ]
    im_doc_keys = [
        d.get("key") for d in docs
        if isinstance(d, dict) and d.get("type") == "im_conversation" and d.get("key")
    ]
    utility_doc_keys = [
        d.get("key") for d in docs
        if isinstance(d, dict) and d.get("type") == "utility_bill" and d.get("key")
    ]

    mykad = parse_mykad(id_number_raw) if mykad_like else {}
    gender = _get(order, "gender") or mykad.get("gender")
    birthday = _get(order, "birthday") or mykad.get("birthday")
    race = _get(order, "race") or _infer_race(name)

    # Residence/service address — assembled from the structured form fields.
    addr_parts = [
        _get(order, "street"),
        _get(order, "city"),
        _get(order, "postcode"),
        _get(order, "state"),
    ]
    residence_address = " ".join(p for p in addr_parts if p).strip()

    customer = {
        "id_type": id_type,
        "id_number": id_number,
        "name": name,
        "gender": gender,
        "birthday": birthday,
        "race": race,
        "nationality": _get(order, "nationality", default=_DEFAULTS["nationality"]),
        "preferred_language": _DEFAULTS["preferred_language"],
        "customer_type": _DEFAULTS["customer_type"],
        "residence_address": residence_address,
        # Structured parts for the Residence Address pop-edit modal (Country +
        # Postcode auto-fills City/State + street Address).
        "residence_street": _get(order, "street") or residence_address,
        "residence_postcode": _get(order, "postcode"),
        "residence_city": _get(order, "city"),
        "residence_state": _get(order, "state"),
        "residence_country": _get(order, "country", "nationality", default="Malaysia"),
        "customer_tenure": _DEFAULTS["customer_tenure"],
        "sub_segment": _DEFAULTS["sub_segment"],
        "segment": _DEFAULTS["segment"],
        "segment_code": _DEFAULTS["segment_code"],
        "contact": {
            "name": name,
            "preferred_contact": "Yes",
            "role": "Owner",  # roleType defaults to Owner (auto/locked)
            "contact_man_type": "Customer Contact",  # portal's Contact Man Type option
            "mobile_prefix": mobile_prefix,
            "mobile": mobile,
            "email": email,
        },
        # Required portal attachment ("Customer ID copy") — R2 keys downloaded at
        # submit time. id_doc_path is a local-file override for testing.
        "id_doc_keys": id_doc_keys,
        "im_doc_keys": im_doc_keys,
        "utility_doc_keys": utility_doc_keys,
        "id_doc_path": None,
    }

    return {
        "customer": customer,
        "address": {
            "customer_type": "Consumer",  # the feasibility Select Address custType
            "search_type": "By keyword",
            "state": _get(order, "state"),
            "keywords": _get(order, "street") or _get(order, "postcode"),
            # Full stored address for exact-match on the results grid (the draft's
            # street is the portal concatAddress when picked serviceable).
            "address_full": _get(order, "street"),
            "postcode": _get(order, "postcode"),
            "address_id": _get(order, "addressId", "address_id"),  # resourceInstId, once the picker exists
            "pick_text": None,
        },
        "plan": (
            {"name": _get(order, "offerName", "offer_name"),
             "category": _get(order, "offerCategory", "offer_category"),
             "all_categories": False}
            if _get(order, "offerName", "offer_name")
            else map_package_to_plan(_get(order, "package", default=""))
        ),
        # Device (VAS) for "with device" packages — select_device ticks it on the
        # Broadband tab by matching the offer code O-<deviceCode>-<group>.
        "deviceCode": _get(order, "deviceCode", "device_code"),
        "deviceName": _get(order, "deviceName", "device_name"),
        # Mandatory Offer-dialog group names an admin recorded for this plan
        # (BizzFlow Admin -> Plan Details). The scraper expands THESE groups
        # rather than trying to detect the portal's red "*" from markup.
        "offer_groups": _get(order, "offerGroups", "offer_groups") or [],
        # Booking policy for the appointment step, set by an admin in BizzFlow
        # and carried per-job. Deliberately travels in the payload rather than
        # in scraper config: changing the policy is then a settings change, not
        # a droplet redeploy. Absent/partial is fine — appointment_policy
        # defaults to first_available / 12h, the behaviour that shipped before.
        "appointment": _appointment_policy(order),
        "remarks": _get(order, "remarks", default=""),
        "_order_id": _get(order, "id"),
        # Where run artefacts (the page-1 screenshot) get filed. `user_id` is
        # filled in by the API server from the authenticated user_key, never from
        # the request body — a caller must not be able to write into another
        # user's R2 namespace.
        "order_ref": {
            "order_id": _get(order, "id"),
            "attempt": _get(order, "attempt", default=1),
            "user_id": None,
        },
    }


if __name__ == "__main__":
    import json

    sample = {
        "id": "test-draft",
        "idType": "MyKad",
        "idNumber": "901106-14-6170",
        "fullName": "ROHANA BINTI MAT ISA",
        "mobilePrefix": "60",
        "mobile": "142427170",
        "email": "rohana@example.com",
        "street": "LOT 4086 JALAN ARA PANJANG",
        "postcode": "33800",
        "city": "Manong",
        "state": "Perak",
        "offerName": "Unifi Home 500Mbps Premium Value With Device (36M)",
        "offerCategory": "Home",
    }
    print(json.dumps(order_to_payload(sample), indent=2, ensure_ascii=False))
