"""
case_to_payload.py - Transform a crawled WifiBizz case into an `enter_order`
payload (the input to order_entry.enter_order).

A WifiBizz home_fibre case gives us: full_name, id_no (MyKad), mobile, email,
full_address, package. Everything else the Unifi eSales order form needs is
either derived (gender/birthday from the IC), parsed (state/postcode from the
address), or defaulted (nationality, segment, ...).

The ONE piece that isn't deterministic is the plan: the WifiBizz `package` string
must map to the portal's Main Offer Selector (category + offer name). That lives
in `map_package_to_plan()` as a pluggable table — until it's filled in, the plan
is emitted as a passthrough placeholder flagged `_needs_mapping: True`, so the
rest of the payload is complete and testable.

Pure functions, no I/O — pass in a case dict (snake_case keys matching the DB
columns) and get a payload dict back.
"""

import html
import re
from datetime import datetime

# ── Malaysian states (longest first so multi-word names match before substrings)
_STATES = [
    "NEGERI SEMBILAN", "PULAU PINANG", "KUALA LUMPUR",
    "JOHOR", "KEDAH", "KELANTAN", "MELAKA", "MALACCA", "PAHANG", "PERAK",
    "PERLIS", "PENANG", "SABAH", "SARAWAK", "SELANGOR", "TERENGGANU",
    "LABUAN", "PUTRAJAYA",
]

# ── Defaults for fields the case doesn't carry ───────────────────────────────
_DEFAULTS = {
    "id_type": "MyKad",
    "nationality": "Malaysia",
    "preferred_language": "Bahasa Malaysia",
    "customer_type": "A",           # A = Individual
    "customer_tenure": "New",
    "sub_segment": "Residential",
    "segment": "Consumer",
    "segment_code": "R10",
}


def parse_mykad(ic: str) -> dict:
    """MyKad `YYMMDD-PB-###G` -> {birthday: 'DD-MM-YYYY', gender: 'Male'|'Female'}.

    Century: assume 2000s unless that lands in the future, then 1900s (the card
    itself doesn't encode the century). Gender: last digit odd=Male, even=Female.
    Returns {} if the IC isn't a parseable 12-digit MyKad.
    """
    digits = re.sub(r"\D", "", ic or "")
    if len(digits) != 12:
        return {}
    yy, mm, dd = int(digits[0:2]), int(digits[2:4]), int(digits[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return {}
    year = 2000 + yy
    if year > datetime.now().year:
        year = 1900 + yy
    try:
        datetime(year, mm, dd)  # validate real calendar date
    except ValueError:
        return {}
    gender = "Male" if int(digits[-1]) % 2 == 1 else "Female"
    return {"birthday": f"{dd:02d}-{mm:02d}-{year}", "gender": gender}


def split_mobile(mobile: str) -> dict:
    """'+60142427170' / '0142427170' / '60142427170' -> {prefix:'60', number:'142427170'}."""
    digits = re.sub(r"\D", "", mobile or "")
    if digits.startswith("60"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = digits[1:]
    return {"prefix": "60", "number": digits}


def _infer_race(name: str) -> str:
    """Best-effort race from Malaysian name markers (portal needs a value).
    BINTI/BIN -> Malay, A/P or A/L -> Indian, else -> Chinese. Heuristic only."""
    n = f" {(name or '').upper()} "
    if " BINTI " in n or " BIN " in n:
        return "Malay"
    if " A/P " in n or " A/L " in n or " AP " in n or " AL " in n:
        return "Indian"
    return "Chinese"


def parse_address(full_address: str) -> dict:
    """Pull state + postcode out of the free-form address and pick a search
    keyword. Shape observed: '<parts> <STATE> MALAYSIA <POSTCODE>'.

    Returns {state, postcode, keywords, cleaned}. `keywords` is a best-effort
    seed for the portal's address search and should be verified on a dry-run.
    """
    cleaned = re.sub(r"\s+", " ", html.unescape(full_address or "")).strip()
    upper = cleaned.upper()

    postcode_match = re.search(r"\b(\d{5})\b", upper)
    postcode = postcode_match.group(1) if postcode_match else None

    state = None
    for s in _STATES:
        if re.search(rf"\b{re.escape(s)}\b", upper):
            state = s
            break

    # Keyword seed: prefer a "JALAN ..." street name, else the chunk before the
    # first " - ", else the postcode.
    keywords = None
    jalan = re.search(r"\bJALAN [A-Z0-9/ ]+?(?= -|$|\bMALAYSIA\b)", upper)
    if jalan:
        keywords = jalan.group(0).strip()
    elif " - " in cleaned:
        keywords = cleaned.split(" - ")[0].strip()
    else:
        keywords = postcode or cleaned[:40]

    # Trim anything from the state name / MALAYSIA / postcode onward so the search
    # keyword stays a clean street rather than the whole address tail.
    if keywords:
        for cut in ([state] if state else []) + ["MALAYSIA"] + ([postcode] if postcode else []):
            idx = keywords.upper().find(cut)
            if idx > 0:
                keywords = keywords[:idx].strip(" ,-")
        keywords = re.sub(r"\s+", " ", keywords).strip() or (postcode or cleaned[:40])

    return {"state": state, "postcode": postcode, "keywords": keywords, "cleaned": cleaned}


def clean_package(package: str) -> str:
    """Decode HTML entities and collapse whitespace in the WifiBizz package string."""
    return re.sub(r"\s+", " ", html.unescape(package or "")).strip()


# Non-Unifi brands — a package mentioning any of these is skipped (we only key
# Unifi orders).
_NON_UNIFI = re.compile(r"\b(maxis|celcom|digi|time|yes|u\s*mobile|astro|unifi air)\b", re.I)

# Known dealer-portal Main Offer names (from the Subscription Plan List). Used to
# validate that a normalized WifiBizz package actually matches a real offer.
# Extend as the full portal list is captured.
_DEALER_OFFERS = {
    "Unifi Home Shield Premium 300Mbps",
    "Unifi Home Shield Premium 500Mbps",
    "Unifi Home 1Gbps Value Broadband (24M)",
    "Unifi Home 1Gbps Premium Value Netflix With Device (36M)",
    "Unifi Home 1Gbps Premium Value MAX With Device (36M)",
    "Unifi Home 1Gbps Premium Value With Device (36M)",
    "Unifi Home Shield Premium Value 300Mbps-Premium Plan (36M)",
    "Unifi Home 100Mbps Premium Value (36M)",
    "Unifi Home 500Mbps Premium Value With Device (36M)",
    "Unifi Home 500Mbps Premium Value MAX With Device (36M)",
}


def is_unifi_package(package: str) -> bool:
    """Only Unifi packages are entered. False for other brands / non-Unifi."""
    p = package or ""
    return "unifi" in p.lower() and not _NON_UNIFI.search(p)


def is_business_package(package: str) -> bool:
    """Unifi Business / Biz packages use a different (business) segment + offer
    path, so they're out of scope for the Residential Home flow."""
    return bool(re.search(r"\bunifi\s+(business|biz)\b", package or "", re.I))


def normalize_to_offer(package: str) -> str:
    """WifiBizz package string -> dealer-portal Main Offer name.

    The WifiBizz name is `<offer> (<term>) + TV<...>/iPad<...> RM<price>`. The
    dealer offer is that with the `+ …` bundle and price removed and bandwidth
    normalized (300M -> 300Mbps, 1G -> 1Gbps) — while the (36M)/(24M) contract
    TERM is preserved verbatim (it is months, not bandwidth).
    """
    s = html.unescape(package or "").replace("​", "").replace("\xa0", " ")
    # Contract term (months), e.g. (24M)/(27M)/(30M)/(36M). Kept as-is.
    term = re.search(r"\((\d{2})\s*M\)", s)
    term_str = f"({term.group(1)}M)" if term else ""

    base = re.split(r"\s*\+\s*", s)[0]                      # drop "+ TV.../+ iPad..."
    base = re.sub(r"\(\d{2}\s*M\)", "", base)               # remove the term from the base
    base = re.sub(r"\bRM\s*\d+(?:\.\d+)?\b", "", base, flags=re.I)  # drop price (incl. decimals)
    base = re.sub(r"\b(\d+)\s*M\b(?!bps)", r"\1Mbps", base)  # 300M -> 300Mbps (bandwidth only)
    base = re.sub(r"\b1\s*G\b(?!bps)", "1Gbps", base)        # 1G -> 1Gbps
    base = re.sub(r"\bwith\b", "With", base, flags=re.I)     # "with Device" -> "With Device"
    base = re.sub(r"\s+", " ", base).strip()
    return f"{base} {term_str}".strip()


def map_package_to_plan(package: str) -> dict:
    """WifiBizz package -> Unifi Main Offer Selector plan.

    Returns {"skip": True, ...} for non-Unifi or Business packages. Otherwise
    normalizes to the dealer offer name and flags whether it matched a known
    portal offer.
    """
    if not is_unifi_package(package):
        return {"skip": True, "reason": "not a Unifi package", "_raw_package": package}
    if is_business_package(package):
        return {"skip": True, "reason": "business package (different flow)", "_raw_package": package}

    offer_name = normalize_to_offer(package)
    known = offer_name in _DEALER_OFFERS
    return {
        "category": None,          # portal category, if offers are grouped
        "name": offer_name,
        "all_categories": False,
        "_raw_package": clean_package(package),
        "_matched_known_offer": known,
        "_needs_mapping": not known,
    }


def _make_login_id(name: str, id_no: str) -> str:
    """Generate a broadband login id (2-11 chars): first name + 2 IC digits."""
    first = re.sub(r"[^a-z]", "", (name or "").split(" ")[0].lower()) or "user"
    suffix = re.sub(r"\D", "", id_no or "")[-2:] or "01"
    return (first[:7] + suffix)[:11]


def case_to_order_payload(case: dict) -> dict:
    """Build an enter_order payload from a WifiBizz case dict.

    Accepts DB-style snake_case keys (full_name, id_no, mobile, email,
    full_address, package). Deterministic except for `plan` (see
    map_package_to_plan). Never raises on bad data — emits best-effort values and
    leaves fields None where it can't derive them, so the caller can validate.
    """
    name = case.get("full_name") or ""
    id_no = case.get("id_no") or ""
    email = case.get("email") or ""
    mobile = split_mobile(case.get("mobile"))
    mykad = parse_mykad(id_no)
    addr = parse_address(case.get("full_address"))
    race = _infer_race(name)

    customer = {
        "id_type": _DEFAULTS["id_type"],
        "id_number": re.sub(r"\D", "", id_no),
        "name": name,
        "gender": mykad.get("gender"),
        "birthday": mykad.get("birthday"),
        "race": race,
        "nationality": _DEFAULTS["nationality"],
        "preferred_language": _DEFAULTS["preferred_language"],
        "customer_type": _DEFAULTS["customer_type"],
        "residence_address": addr["cleaned"],
        "customer_tenure": _DEFAULTS["customer_tenure"],
        "sub_segment": _DEFAULTS["sub_segment"],
        "segment": _DEFAULTS["segment"],
        "segment_code": _DEFAULTS["segment_code"],
        "contact": {
            "name": name,
            "preferred_contact": "Yes",
            "role": "Owner",
            "contact_man_type": "Owner",
            "mobile_prefix": mobile["prefix"],
            "mobile": mobile["number"],
            "email": email,
        },
        "id_doc_path": None,
    }

    return {
        "customer": customer,
        "address": {
            "customer_type": "Individual",
            "search_type": "By keyword",
            "state": addr["state"],
            "keywords": addr["keywords"],
            "postcode": addr["postcode"],
            "pick_text": None,
        },
        "plan": map_package_to_plan(case.get("package")),
        "login_id": _make_login_id(name, id_no),
        "appointment": {"strategy": "earliest"},
        "contactless": True,
        "_source_case_no": case.get("case_no"),
    }


if __name__ == "__main__":
    import json

    samples = [
        {"full_name": "ROHANA BINTI MAT ISA", "id_no": "901106146170",
         "mobile": "+60142427170", "email": "",
         "package": "Unifi Home 500Mbps Premium Value With Device + TV 55&quot; or iPad 11&quot; (36M) RM159",
         "full_address": "LOT 4086 JALAN ARA PANJANG - KAMPUNG PULAI MANONG PERAK MALAYSIA 33800",
         "case_no": "TEST001"},
        {"full_name": "SARASWATHY A/P RAMASAMY", "id_no": "781111085460",
         "mobile": "+60166829326", "email": "",
         "package": "Unifi Home 500Mbps Premium Value With Device + TV 55&quot; (36M) RM159",
         "full_address": "2-3-2 JALAN UTARID U5/9 3 FTTH BLOK 2 PANGSAPURI MUTIARA SUBANG SEKSYEN U5 SHAH ALAM SELANGOR MALAYSIA 40150",
         "case_no": "TEST002"},
    ]
    for s in samples:
        print(json.dumps(case_to_order_payload(s), indent=2, ensure_ascii=False))
        print("-" * 60)
