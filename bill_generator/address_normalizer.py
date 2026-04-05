"""
Address Normalization Pipeline for Bill Generation.

3-step pipeline shared by both Internet Bill and Utility Bill generators:
  1. Pre-clean (local, no API) — strip FTTH artifacts, *, MALAYSIA; extract unit prefix
  2. Google Geocoding API — get postcode, city, state (structural info only)
  3. Format per bill type — internet (no masking) vs utility (with masking)

Hybrid approach: Google provides postcode/city/state, but original street text
is preserved to avoid the API rewriting street names.
"""

import os
import re
import json

try:
    from urllib.request import urlopen, Request
    from urllib.parse import urlencode
except ImportError:
    urlopen = None


# ── Malaysian state names ─────────────────────────────────────────

STATES = [
    'WP KUALA LUMPUR', 'WP PUTRAJAYA', 'WP LABUAN',
    'WILAYAH PERSEKUTUAN KUALA LUMPUR', 'WILAYAH PERSEKUTUAN PUTRAJAYA',
    'WILAYAH PERSEKUTUAN LABUAN',
    'NEGERI SEMBILAN', 'PULAU PINANG',
    'JOHOR', 'KEDAH', 'KELANTAN', 'MELAKA',
    'PAHANG', 'PERAK', 'PERLIS', 'SABAH', 'SARAWAK',
    'SELANGOR', 'TERENGGANU',
    'KUALA LUMPUR', 'PUTRAJAYA', 'LABUAN',
]

# Street keywords for line splitting
STREET_KEYWORDS = [
    'JALAN', 'JLN', 'LORONG', 'LRG', 'PERSIARAN', 'LEBUH',
    'TAMAN', 'TMN', 'KAMPUNG', 'KG', 'DESA', 'BANDAR',
    'FELDA', 'LADANG', 'PEKAN', 'PERUMAHAN',
    'RESIDENSI', 'FLAT', 'BLOK',
]


# ── Step 1: Pre-clean ─────────────────────────────────────────────

def preclean(raw_address):
    """Pre-clean raw address before processing.

    Returns:
        (cleaned_address, unit_prefix)
        unit_prefix is None for landed, e.g. 'S2D-12-6' for condo.
    """
    addr = raw_address.strip().upper()
    addr = re.sub(r'\s+', ' ', addr)

    # Strip leading asterisk (data artifact)
    addr = re.sub(r'^\*+', '', addr).strip()

    # Strip FTTH artifacts: e.g. "12 FTTH S2D", "8 FTTH G9"
    addr = re.sub(r'\b\d+\s+FTTH\s+[A-Z0-9]+\b', '', addr, flags=re.IGNORECASE)
    addr = re.sub(r'\s+', ' ', addr).strip().strip(',').strip()

    # Strip MALAYSIA (utility bill doesn't use it; internet bill appends separately)
    addr = re.sub(r'\bMALAYSIA\b', '', addr).strip()
    addr = re.sub(r'\s+', ' ', addr).strip().rstrip(',').strip()

    # Extract condo unit prefix: e.g. S2D-12-6, G9-3-8, A-10-1
    # Must start with letter(s), then dash-digits pattern
    # Simple numbers like 2-1 are NOT condo prefixes
    unit_prefix = None
    m = re.match(r'^([A-Z][A-Z0-9]*-\d+-\d+)\b[\s,]*(.*)', addr, re.IGNORECASE)
    if m:
        unit_prefix = m.group(1).upper()
        addr = m.group(2).strip().strip(',').strip()

    return addr, unit_prefix


# ── Step 2: Google Geocoding API (structural info only) ───────────

def geocode(cleaned_address, api_key=None):
    """Send cleaned address to Google Geocoding API.

    Returns dict with structural components:
        postal_code, locality (city), state, lat, lng

    Note: route/sublocality from Google are NOT used — we preserve
    the original street text instead.
    """
    if api_key and urlopen:
        try:
            return _geocode_api(cleaned_address, api_key)
        except Exception as e:
            print(f'  Geocoding API failed ({e}), falling back to local parsing')

    return {}


def _geocode_api(cleaned_address, api_key):
    """Call Google Geocoding API and extract structural components."""
    params = urlencode({
        'address': cleaned_address,
        'region': 'my',
        'key': api_key,
    })
    url = f'https://maps.googleapis.com/maps/api/geocode/json?{params}'
    req = Request(url, headers={'User-Agent': 'BillGenerator/1.0'})
    resp = urlopen(req, timeout=10)
    data = json.loads(resp.read().decode('utf-8'))

    if data['status'] != 'OK' or not data['results']:
        raise ValueError(f'Geocoding returned status: {data["status"]}')

    result = data['results'][0]
    components = {}

    for comp in result['address_components']:
        types = comp['types']
        name = comp['long_name'].upper()
        if 'postal_code' in types and 'postal_code' not in components:
            components['postal_code'] = name
        if 'locality' in types and 'locality' not in components:
            components['locality'] = name
        if 'administrative_area_level_1' in types and 'state' not in components:
            components['state'] = name

    # Extract lat/lng for potential Kedai Tenaga lookup
    loc = result['geometry']['location']
    components['lat'] = loc['lat']
    components['lng'] = loc['lng']

    return components


# ── Local address parsing (extract street, postcode, city, state) ─

def _extract_structure(cleaned_address, google_components=None):
    """Extract structured address parts from cleaned address text.

    Uses original address text for street, merges with Google for
    postcode/city/state when available.

    Returns dict with: street_number, route, sublocality,
                       postal_code, locality, state
    """
    addr = cleaned_address
    addr = re.sub(r',\s*', ' ', addr)
    addr = re.sub(r'\s+', ' ', addr).strip()

    # Remove WILAYAH PERSEKUTUAN (redundant, state list has WP variants)
    addr = re.sub(r'\bWILAYAH\s+PERSEKUTUAN\b', '', addr).strip()
    addr = re.sub(r'\s+', ' ', addr).strip().rstrip(',').strip()

    components = {}

    # Extract state from address text
    addr_remaining = addr
    for s in sorted(STATES, key=len, reverse=True):
        m = re.search(r'\b' + re.escape(s) + r'\b', addr_remaining)
        if m:
            components['state'] = _normalize_state(s)
            addr_remaining = (addr_remaining[:m.start()] + addr_remaining[m.end():]).strip()
            addr_remaining = re.sub(r'\s+', ' ', addr_remaining).strip().rstrip(',').strip()
            break

    # Extract postcode (last 5-digit sequence)
    postcode_match = None
    for m in re.finditer(r'\b(\d{5})\b', addr_remaining):
        postcode_match = m

    if postcode_match:
        components['postal_code'] = postcode_match.group(1)
        before = addr_remaining[:postcode_match.start()].strip().rstrip(',').strip()
        after = addr_remaining[postcode_match.end():].strip().rstrip(',').strip()

        if after:
            components['locality'] = after
        else:
            # Postcode at end — try to extract city as last word before postcode
            # Skip for federal territories (city = state name, handled later)
            state = components.get('state', '')
            is_ft = state in ('WP KUALA LUMPUR', 'WP PUTRAJAYA', 'WP LABUAN')
            if not is_ft:
                words = before.split()
                if words:
                    last_word = words[-1]
                    kw_set = set(kw.upper() for kw in STREET_KEYWORDS)
                    if (last_word not in kw_set and not re.match(r'^\d', last_word)
                            and len(last_word) >= 4):
                        components['locality'] = last_word
                        before = ' '.join(words[:-1])
        street_text = before
    else:
        street_text = addr_remaining

    # Use Google data to fill gaps (not override local results)
    if google_components:
        if 'postal_code' not in components and 'postal_code' in google_components:
            components['postal_code'] = google_components['postal_code']
        if 'locality' not in components and 'locality' in google_components:
            components['locality'] = google_components['locality']
        if 'state' not in components and 'state' in google_components:
            components['state'] = _normalize_state(google_components['state'])
        # Always take lat/lng from Google (for Kedai Tenaga lookup)
        if 'lat' in google_components:
            components['lat'] = google_components['lat']
            components['lng'] = google_components['lng']

    # For federal territories, locality = city name (override any bad extraction)
    state = components.get('state', '')
    if state == 'WP KUALA LUMPUR':
        components['locality'] = 'KUALA LUMPUR'
    elif state == 'WP PUTRAJAYA':
        components['locality'] = 'PUTRAJAYA'
    elif state == 'WP LABUAN':
        components['locality'] = 'LABUAN'
    # For non-FT states, use Google locality to fill gap only
    elif 'locality' not in components and google_components and 'locality' in google_components:
        components['locality'] = google_components['locality']

    # Parse street_text into street_number + route + sublocality
    _parse_street(street_text, components)

    return components


def _parse_street(street_text, components):
    """Parse street text into street_number, route, sublocality."""
    if not street_text:
        return

    text = street_text.strip()

    # Extract leading house/lot number
    # Match: digits, digits+letter, LOT X, NO X, or alphanumeric with slashes/dashes
    num_match = re.match(
        r'^((?:LOT|NO\.?)\s+\d+[\dA-Z\-/]*|\d+[\dA-Z\-/]*)\s+(.*)',
        text, re.IGNORECASE
    )
    if num_match:
        components['street_number'] = num_match.group(1).upper()
        text = num_match.group(2).strip()

    # Split into route (street 1) and sublocality (street 2)
    # at the second independent street keyword boundary.
    # Skip JALAN/JLN immediately following LORONG/LRG (compound: LORONG JALAN X)
    kw_pattern = r'\b(?:' + '|'.join(STREET_KEYWORDS) + r')\b'
    kw_matches = []
    for m in re.finditer(kw_pattern, text, re.IGNORECASE):
        kw = m.group().upper()
        # Skip JALAN/JLN right after LORONG/LRG (compound street name)
        if kw in ('JALAN', 'JLN') and kw_matches:
            prev_kw = kw_matches[-1][1].upper()
            if prev_kw in ('LORONG', 'LRG'):
                continue
        kw_matches.append((m.start(), m.group()))

    if len(kw_matches) >= 2:
        split_at = kw_matches[1][0]
        components['route'] = text[:split_at].strip().rstrip(',').strip()
        components['sublocality'] = text[split_at:].strip().rstrip(',').strip()
    else:
        components['route'] = text


# ── State normalization ───────────────────────────────────────────

def _normalize_state(state):
    """Normalize state name — use WP prefix for federal territories."""
    state = state.upper().strip()
    if state in ('KUALA LUMPUR', 'WILAYAH PERSEKUTUAN KUALA LUMPUR',
                 'FEDERAL TERRITORY OF KUALA LUMPUR'):
        return 'WP KUALA LUMPUR'
    if state in ('PUTRAJAYA', 'WILAYAH PERSEKUTUAN PUTRAJAYA',
                 'FEDERAL TERRITORY OF PUTRAJAYA'):
        return 'WP PUTRAJAYA'
    if state in ('LABUAN', 'WILAYAH PERSEKUTUAN LABUAN',
                 'FEDERAL TERRITORY OF LABUAN'):
        return 'WP LABUAN'
    if state.startswith('WP '):
        return state
    return state


# ── Line splitting helpers ────────────────────────────────────────

def _smart_split(text, max_chars):
    """Split text at street keyword boundaries if it exceeds max_chars."""
    if len(text) <= max_chars:
        return [text]

    kw_pattern = r'\b(?:' + '|'.join(STREET_KEYWORDS) + r')\b'
    best_split = None
    for m in re.finditer(kw_pattern, text, re.IGNORECASE):
        pos = m.start()
        first = text[:pos].strip().rstrip(',').strip()
        if 0 < len(first) <= max_chars:
            best_split = pos

    if best_split:
        line1 = text[:best_split].strip().rstrip(',').strip()
        remainder = text[best_split:].strip()
        return [line1] + _smart_split(remainder, max_chars)

    # Fallback: word-wrap
    return _wrap(text, max_chars)


def _wrap(text, max_chars):
    """Simple word-wrap."""
    if len(text) <= max_chars:
        return [text]
    words = text.split()
    lines = []
    current = words[0]
    for w in words[1:]:
        if len(current) + 1 + len(w) <= max_chars:
            current += ' ' + w
        else:
            lines.append(current)
            current = w
    lines.append(current)
    return lines


def _build_street_line(components):
    """Combine route and sublocality into street text."""
    parts = []
    if components.get('route'):
        parts.append(components['route'])
    if components.get('sublocality'):
        parts.append(components['sublocality'])
    return ' '.join(parts)


def _build_postcode_city(components, include_state=True, include_country=False):
    """Build the postcode+city+state line."""
    parts = []
    if components.get('postal_code'):
        parts.append(components['postal_code'])
    if components.get('locality'):
        parts.append(components['locality'])
    if include_state and components.get('state'):
        parts.append(components['state'])
    if include_country:
        parts.append('MALAYSIA')
    return ' '.join(parts)


# ── Internet Bill Formatting (no masking) ─────────────────────────

def format_internet_address(components, unit_prefix=None, max_chars=55):
    """Format address for Internet Bill (U Mobile style).

    Landed (2 lines):
        UNIT STREET1 STREET2
        POSTCODE CITY STATE MALAYSIA

    Condo (3 lines):
        UNIT CONDO_NAME
        STREET1 STREET2
        POSTCODE CITY STATE MALAYSIA

    No masking applied. Includes MALAYSIA at the end.
    """
    street = _build_street_line(components)
    postcode_line = _build_postcode_city(components, include_state=True, include_country=True)

    unit = components.get('street_number', '')

    if unit_prefix:
        # Condo: 3 lines — use route as condo name, sublocality as street
        route = components.get('route', '')
        sublocality = components.get('sublocality', '')

        line1 = f'{unit_prefix} {route}'.strip()
        lines = _smart_split(line1, max_chars)
        if sublocality:
            lines += _smart_split(sublocality, max_chars)
        lines.append(postcode_line)
    else:
        # Landed: 2 lines
        street_with_unit = f'{unit} {street}'.strip() if unit else street
        lines = _smart_split(street_with_unit, max_chars)
        lines.append(postcode_line)

    return lines[:3]


# ── Utility Bill Formatting (with masking) ────────────────────────

def format_utility_alamat_pos(components, unit_prefix=None, full_name='', max_chars=40):
    """Format ALAMAT POS for Utility Bill page 1.

    Landed (5 lines):
        XXXXXXXXXXXXXXXXXX          (masked name)
        XXX XXX, STREET 1
        STREET 2
        POSTCODE CITY
        STATE

    Condo (6 lines):
        XXXXXXXXXXXX                (masked name)
        XXX XXX,CONDO NAME
        STREET 1 OFF STREET 2
        POSTCODE CITY
        STATE
    """
    masked_name = 'X' * max(len(full_name), 12)

    route = components.get('route', '')
    sublocality = components.get('sublocality', '')
    postcode_city = _build_postcode_city(components, include_state=False)
    state = components.get('state', '')  # already normalized

    lines = [masked_name]

    if unit_prefix:
        # Condo: route = condo name, sublocality = street
        lines.append(f'XXX XXX,{route}')
        if sublocality:
            lines += _smart_split(sublocality, max_chars)
    else:
        # Landed: route = street 1, sublocality = street 2
        lines.append(f'XXX XXX, {route}')
        if sublocality:
            lines += _smart_split(sublocality, max_chars)

    lines.append(postcode_city)
    if state:
        lines.append(state)

    return lines


def format_utility_alamat_premis(components, unit_prefix=None, max_chars=33):
    """Format ALAMAT PREMIS for Utility Bill page 2.

    Same as ALAMAT POS but without the masked name line.
    """
    route = components.get('route', '')
    sublocality = components.get('sublocality', '')
    postcode_city = _build_postcode_city(components, include_state=False)
    state = components.get('state', '')

    lines = []

    if unit_prefix:
        lines.append(f'XXX XXX,{route}')
        if sublocality:
            lines += _smart_split(sublocality, max_chars)
    else:
        lines.append(f'XXX XXX, {route}')
        if sublocality:
            lines += _smart_split(sublocality, max_chars)

    lines.append(postcode_city)
    if state:
        lines.append(state)

    return lines


# ── High-level normalize function ─────────────────────────────────

def normalize_address(raw_address, bill_type='internet', full_name='',
                      max_chars=None, api_key=None):
    """Full 3-step address normalization pipeline.

    Args:
        raw_address: Raw address string from case list
        bill_type: 'internet' or 'utility'
        full_name: Customer name (used for masking length in utility bill)
        max_chars: Max characters per line (uses bill-type defaults if None)
        api_key: Google Maps API key (falls back to local parsing if None)

    Returns:
        For internet: list of address lines (2-3 lines)
        For utility: dict with 'alamat_pos' and 'alamat_premis' line lists
    """
    if not api_key:
        api_key = os.environ.get('GOOGLE_MAPS_API_KEY')

    # Step 1: Pre-clean
    cleaned, unit_prefix = preclean(raw_address)

    print(f'  Pre-clean: {cleaned}')
    print(f'  Unit prefix: {unit_prefix or "(none - landed)"}')

    # Step 2: Try local parsing first — skip geocoding if we have postcode + state
    local_components = _extract_structure(cleaned, None)

    if local_components.get('postal_code') and local_components.get('state'):
        # Local parsing is sufficient — skip the slow geocoding API call
        print(f'  Local parsing sufficient (postcode={local_components["postal_code"]}, state={local_components["state"]}), skipping geocode')
        components = local_components
    else:
        # Fall back to Google Geocoding for missing structural info
        google_components = geocode(cleaned, api_key)
        components = _extract_structure(cleaned, google_components)

    print(f'  Parsed: street_number={components.get("street_number", "")}, '
          f'route={components.get("route", "")}, '
          f'sublocality={components.get("sublocality", "")}, '
          f'locality={components.get("locality", "")}, '
          f'state={components.get("state", "")}, '
          f'postal_code={components.get("postal_code", "")}')

    # Step 4: Format per bill type
    if bill_type == 'internet':
        mc = max_chars or 55
        return format_internet_address(components, unit_prefix, max_chars=mc)
    else:
        mc_p1 = 40
        mc_p2 = max_chars or 33
        return {
            'alamat_pos': format_utility_alamat_pos(
                components, unit_prefix, full_name, max_chars=mc_p1),
            'alamat_premis': format_utility_alamat_premis(
                components, unit_prefix, max_chars=mc_p2),
            'components': components,
        }
