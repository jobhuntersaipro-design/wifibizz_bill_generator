import pikepdf
import random
import calendar
import os
import sys
import re
import json
from datetime import date

try:
    import psycopg2
except ImportError:
    psycopg2 = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from address_normalizer import normalize_address


# ── Fetch customer data from Neon DB (fallback when no stdin data) ─
def fetch_case(case_no):
    if psycopg2 is None:
        print('Error: psycopg2 is required when not passing data via stdin')
        sys.exit(1)

    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print('Error: DATABASE_URL environment variable is required')
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()
    cur.execute(
        'SELECT case_no, full_name, full_address, mobile FROM wifibizz_cases WHERE case_no = %s',
        (case_no,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        print(f'Error: No case found with case_no = {case_no}')
        sys.exit(1)

    return {'case_no': row[0], 'full_name': row[1], 'full_address': row[2], 'mobile': row[3]}


# ── Original values from utility_bill_template.pdf ────────────────
ORIGINAL_ACCOUNT = '2202926650XX'
ORIGINAL_ACCOUNT_DIGITS = '926650'  # the 6 middle digits to randomize

# Original dates (DD.MM.YYYY format as they appear in the PDF)
ORIG_TARIKH_BIL = '03.03.2026'
ORIG_TEMPOH_START = '02.02.2026'
ORIG_TEMPOH_END = '01.03.2026'
ORIG_LAST_PAYMENT_DATE = '10.02.2026'  # page 2 "Tarikh :"

# Original invoice and deposit
ORIG_INVOIS = '000870861263'
ORIG_DEPOSIT = '204.84'
ORIG_BAYARAN = '221.80'

# Original barcode: account + invoice + trailing
ORIG_BARCODE_TAIL = '000000000032995'  # 0000000000 + 32995

# Address patterns to blank out on page 1 (ALAMAT POS)
PAGE1_NAME_PATTERN = b'(XXXXXXXXXXXXXXXXXX)'
PAGE1_ADDR_PATTERNS = [
    b'(XXX XXX, JALAN CEMPEDAK)',
    b'(KAMPUNG KANCHONG DARAT)',
    b'(42700 BANTING)',
    b'(SELANGOR)',
]

# Address patterns to blank out on page 2 (ALAMAT PREMIS)
PAGE2_ADDR_PATTERNS = [
    b'(XXX XXX, JALAN CEMPEDAK)',
    b'(KAMPUNG KANCHONG DARAT)',
    b'(42700 BANTING)',
    b'(SELANGOR)',
]

# Kedai Tenaga patterns on page 2
KEDAI_TENAGA_PATTERNS = [
    b'(TNB BANTING)',
    b'(LOT 4, JLN BUNGA PEKAN)',
    # b'(42700 BANTING)',  # already in PAGE2_ADDR_PATTERNS context
    # b'(SELANGOR)',
]

# Page 1 overlay coordinates (ALAMAT POS area)
PAGE1_OVERLAY = {
    'x': 36.0,
    'name_y': 756.668,
    'addr1_y': 745.081,
    'addr2_y': 733.493,
    'addr3_y': 721.906,
    'addr4_y': 710.318,
    'box_x': 34,
    'box_y': 708,
    'box_w': 180,  # stay within column divider at x=217
    'box_h': 55,
    'font_size': 8.0,
    'name_font': '/F0201',  # Tahoma-Bold
    'addr_font': '/F0301',  # Tahoma
    'max_chars': 40,
}

# Page 2 overlay coordinates (ALAMAT PREMIS area)
# Column is narrower on page 2 — icon at x=189, text at x=214
PAGE2_OVERLAY = {
    'x': 36.0,
    'addr1_y': 730.687,
    'addr2_y': 719.100,
    'addr3_y': 707.512,
    'addr4_y': 695.925,
    'addr5_y': 684.337,
    'box_x': 34,
    'box_y': 682,
    'box_w': 152,  # stay clear of icon at x=189
    'box_h': 53,
    'font_size': 8.0,
    'addr_font': '/F0301',  # Tahoma
    'max_chars': 33,
}

# Kedai Tenaga overlay coordinates on page 2
KEDAI_OVERLAY = {
    'x': 297.0,
    'line1_y': 86.687,
    'line2_y': 77.031,
    'line3_y': 67.375,
    'line4_y': 57.719,
    'box_x': 295,
    'box_y': 54,
    'box_w': 160,
    'box_h': 42,
    'font_size': 8.0,
    'addr_font': '/F0301',  # Tahoma
    'max_chars': 35,
}


def generate_account():
    """Generate new account number: 2202 + 6 random digits + XX"""
    middle = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    return f'2202{middle}XX'


def compute_values():
    """Compute all randomized replacement values for the utility bill."""
    today = date.today()

    # 1. TARIKH BIL: previous month, random day 01-03
    prev_m = today.month - 1 if today.month > 1 else 12
    prev_y = today.year if today.month > 1 else today.year - 1
    bill_day = random.randint(1, 3)
    tarikh_bil = date(prev_y, prev_m, bill_day)

    # 2. TEMPOH BIL: previous month relative to TARIKH BIL
    tempoh_m = prev_m - 1 if prev_m > 1 else 12
    tempoh_y = prev_y if prev_m > 1 else prev_y - 1
    days_in_tempoh = calendar.monthrange(tempoh_y, tempoh_m)[1]
    tempoh_start = date(tempoh_y, tempoh_m, 1)
    tempoh_end = date(tempoh_y, tempoh_m, days_in_tempoh)

    # 3. NO. INVOIS: 000870 + 6 random digits
    invois_suffix = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    new_invois = f'000870{invois_suffix}'

    # 4. BAYARAN BAGI TEMPOH: RM100.00-RM250.00 randomized
    bayaran_amount = random.uniform(100.00, 250.00)
    new_bayaran = f'{bayaran_amount:.2f}'

    # 5. DEPOSIT SEKURITI: RM100.00 to RM250.00 randomized
    deposit_amount = random.uniform(100.00, 250.00)
    new_deposit = f'{deposit_amount:.2f}'

    # 6. Barcode: NO.AKAUN + NO.INVOIS + 0000000000 + 5 random digits
    barcode_tail_rand = ''.join([str(random.randint(0, 9)) for _ in range(5)])
    new_barcode_tail = f'0000000000{barcode_tail_rand}'

    # Last payment date: random day within the billing period
    pay_day = random.randint(tempoh_start.day, tempoh_end.day)
    last_payment_date = date(tempoh_y, tempoh_m, pay_day)

    def ddmmyyyy(d):
        return f'{d.day:02d}.{d.month:02d}.{d.year}'

    return {
        'tarikh_bil': ddmmyyyy(tarikh_bil),
        'tempoh_start': ddmmyyyy(tempoh_start),
        'tempoh_end': ddmmyyyy(tempoh_end),
        'days_in_period': str(days_in_tempoh),
        'new_invois': new_invois,
        'new_bayaran': new_bayaran,
        'new_deposit': new_deposit,
        'new_barcode_tail': new_barcode_tail,
        'last_payment_date': ddmmyyyy(last_payment_date),
    }




# System font paths for embedding
FONT_PATHS = {
    '/Tahoma-Bold': '/System/Library/Fonts/Supplemental/Tahoma Bold.ttf',
    '/Tahoma': '/System/Library/Fonts/Supplemental/Tahoma.ttf',
    '/Verdana-Bold': '/System/Library/Fonts/Supplemental/Verdana Bold.ttf',
    '/Verdana': '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/ArialMT': '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Arial-BoldMT': '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
}


def embed_fonts(pdf):
    """Embed TrueType fonts into the PDF so all viewers render them identically."""
    count = 0
    for page in pdf.pages:
        fonts = page.get('/Resources', {}).get('/Font', {})
        for font_name in fonts.keys():
            font = fonts[font_name]
            base_font = str(font.get('/BaseFont', ''))
            desc = font.get('/FontDescriptor', None)
            if desc is None:
                continue
            # Skip if already embedded
            if '/FontFile2' in desc:
                continue
            # Find matching system font
            ttf_path = FONT_PATHS.get(base_font)
            if ttf_path and os.path.exists(ttf_path):
                with open(ttf_path, 'rb') as f:
                    font_data = f.read()
                font_stream = pdf.make_stream(font_data)
                font_stream[pikepdf.Name('/Length1')] = len(font_data)
                desc[pikepdf.Name('/FontFile2')] = font_stream
                count += 1
    return count


def blank_pattern_in_stream(buf, pattern):
    """Replace all printable chars inside (...) of a specific pattern with spaces."""
    idx = buf.find(pattern)
    if idx < 0:
        return 0

    result = bytearray(buf)
    # Find the parenthesized portion and blank it
    start = idx
    end = idx + len(pattern)
    for i in range(start, end):
        if result[i] == 0x28:  # '('
            j = i + 1
            while j < end and result[j] != 0x29:  # ')'
                if result[j] != 0x5C:  # not backslash
                    result[j] = 0x20  # space
                j += 1
    buf[:] = result
    return 1


def replace_string_in_stream(buf, old_str, new_str):
    """Replace a parenthesized string (old_str) -> (new_str) in PDF stream.
    Both strings must be the same length to preserve PDF structure.
    """
    old_bytes = old_str.encode('ascii')
    new_bytes = new_str.encode('ascii')
    assert len(old_bytes) == len(new_bytes), \
        f'Length mismatch: {old_str!r} ({len(old_bytes)}) vs {new_str!r} ({len(new_bytes)})'
    old_tj = b'(' + old_bytes + b')'
    new_tj = b'(' + new_bytes + b')'
    count = 0
    while old_tj in buf:
        idx = buf.find(old_tj)
        buf[idx:idx + len(old_tj)] = new_tj
        count += 1
    return count


def replace_account_in_stream(buf, old_account, new_account):
    """Replace account number string in PDF content stream.
    Handles both (account) Tj format and individual character Tj format.
    """
    count = replace_string_in_stream(buf, old_account, new_account)

    # Replace individual character barcode text at y=577.28
    # These appear as: BT xx.xxx 577.28 Td /F0401 ... Tf (X) Tj
    # Full barcode: 2202926650XX|000870861263|000000000032995
    # Positions 4-9 are the randomized account digits
    old_middle = old_account[4:10]  # '926650'
    new_middle = new_account[4:10]

    barcode_pattern = re.compile(
        rb'BT\s+([\d.]+)\s+577\.28\d*\s+Td\s+/F0401\s+[\d.]+\s+Tf\s+\((.)\)\s+Tj'
    )

    chars = []
    for m in barcode_pattern.finditer(bytes(buf)):
        x = float(m.group(1))
        char = m.group(2)
        char_start = m.start(2)
        chars.append((x, char, char_start))

    chars.sort(key=lambda c: c[0])

    if len(chars) >= 10:
        for i in range(4, 10):
            if i < len(chars):
                old_char = old_middle[i - 4].encode('ascii')
                new_char = new_middle[i - 4].encode('ascii')
                pos = chars[i][2]
                if buf[pos:pos + 1] == old_char:
                    buf[pos] = new_char[0]
                    count += 1

    return count


def replace_barcode_in_stream(buf, new_invois, new_barcode_tail):
    """Replace invoice and tail portions of the barcode individual chars.
    Barcode layout: account(12) + invoice(12) + tail(15) = 39 chars
    """
    barcode_pattern = re.compile(
        rb'BT\s+([\d.]+)\s+577\.28\d*\s+Td\s+/F0401\s+[\d.]+\s+Tf\s+\((.)\)\s+Tj'
    )

    chars = []
    for m in barcode_pattern.finditer(bytes(buf)):
        x = float(m.group(1))
        char_start = m.start(2)
        chars.append((x, char_start))

    chars.sort(key=lambda c: c[0])
    count = 0

    if len(chars) >= 39:
        # Positions 12-23: invoice (000870XXXXXX)
        for i in range(12, 24):
            new_char = new_invois[i - 12].encode('ascii')
            pos = chars[i][1]
            buf[pos] = new_char[0]
            count += 1

        # Positions 24-38: tail (0000000000XXXXX)
        for i in range(24, 39):
            new_char = new_barcode_tail[i - 24].encode('ascii')
            pos = chars[i][1]
            buf[pos] = new_char[0]
            count += 1

    return count


def overlay_text(pdf, page, lines, overlay_config, is_name_first=False):
    """Overlay text on a page using white-out rectangle + new text.

    If is_name_first=True, first line uses bold font for the name.
    """
    o = overlay_config
    fs = o['font_size']

    # Escape text for PDF string literal
    def esc(text):
        return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    # White-out rectangle
    overlay = (
        f'q\n'
        f'1 1 1 rg\n'
        f'{o["box_x"]} {o["box_y"]} {o["box_w"]} {o["box_h"]} re f\n'
        f'Q\n'
    )

    y_keys = ['name_y', 'addr1_y', 'addr2_y', 'addr3_y', 'addr4_y'] if is_name_first else \
             ['addr1_y', 'addr2_y', 'addr3_y', 'addr4_y', 'addr5_y']

    # For Kedai Tenaga overlay
    if 'line1_y' in o:
        y_keys = ['line1_y', 'line2_y', 'line3_y', 'line4_y']

    for i, line in enumerate(lines):
        if i >= len(y_keys):
            break
        y_key = y_keys[i]
        if y_key not in o:
            break
        y = o[y_key]

        # Use bold font for name (first line when is_name_first)
        if is_name_first and i == 0:
            font = o.get('name_font', o['addr_font'])
        else:
            font = o['addr_font']

        overlay += (
            f'BT\n'
            f'{font} {fs} Tf\n'
            f'0 g\n'
            f'{o["x"]} {y} Td\n'
            f'({esc(line)}) Tj\n'
            f'ET\n'
        )

    overlay_stream = pdf.make_stream(overlay.encode('latin-1'))
    contents = page.get('/Contents')
    if isinstance(contents, pikepdf.Array):
        contents.append(overlay_stream)
    else:
        page[pikepdf.Name('/Contents')] = pikepdf.Array([contents, overlay_stream])

    return len(lines)


def replace_in_annotations(page, old_account, new_account):
    """Replace account number in annotation URLs."""
    count = 0
    if '/Annots' not in page:
        return count

    annots = page['/Annots']
    for ann in annots:
        try:
            if '/A' in ann and '/URI' in ann['/A']:
                uri = str(ann['/A']['/URI'])
                if old_account in uri:
                    new_uri = uri.replace(old_account, new_account)
                    ann['/A'][pikepdf.Name('/URI')] = pikepdf.String(new_uri)
                    count += 1
        except Exception:
            pass
    return count


# ── Main ───────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print('Usage: python generate-utility-bill.py <case_no>')
        print('       echo \'{"case_no":"...","full_name":"...","full_address":"...","mobile":"..."}\' | python generate-utility-bill.py <case_no>')
        sys.exit(1)

    case_no = sys.argv[1]

    # Try reading customer data from stdin (passed by API), fall back to DB query
    if not sys.stdin.isatty():
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            case = json.loads(stdin_data)
            print(f'Using provided data for case {case_no}')
        else:
            print(f'Fetching case {case_no} from database...')
            case = fetch_case(case_no)
    else:
        print(f'Fetching case {case_no} from database...')
        case = fetch_case(case_no)
    print(f'  Customer: {case["full_name"]}')
    print(f'  Address : {case["full_address"]}')
    print(f'  Mobile  : {case["mobile"]}')

    # Generate new values
    new_account = generate_account()
    vals = compute_values()
    print(f'  Account : {ORIGINAL_ACCOUNT} -> {new_account}')
    print(f'  Invois  : {ORIG_INVOIS} -> {vals["new_invois"]}')
    print(f'  Tarikh  : {ORIG_TARIKH_BIL} -> {vals["tarikh_bil"]}')
    print(f'  Tempoh  : {vals["tempoh_start"]} - {vals["tempoh_end"]}')
    print(f'  Deposit : {ORIG_DEPOSIT} -> {vals["new_deposit"]}')

    # Normalize address via 3-step pipeline (pre-clean, geocode, format)
    addr_result = normalize_address(
        case['full_address'],
        bill_type='utility',
        full_name=case['full_name'],
    )
    addr_lines_p1 = addr_result['alamat_pos']
    addr_lines_p2 = addr_result['alamat_premis']
    components = addr_result['components']

    for i, line in enumerate(addr_lines_p1):
        print(f'  ALAMAT POS L{i+1} : {line}')
    for i, line in enumerate(addr_lines_p2):
        print(f'  ALAMAT PREMIS L{i+1} : {line}')

    # Check if Sabah/Sarawak for Kedai Tenaga logic
    state = components.get('state', '')
    east_malaysia = state if state in ('SABAH', 'SARAWAK') else None
    if east_malaysia:
        print(f'  State   : {east_malaysia} (East Malaysia - keeping Kedai Tenaga as-is)')
    else:
        print(f'  State   : {state or "unknown"} (Kedai Tenaga replacement deferred)')

    # Resolve paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(script_dir, 'template', 'utility_bill_template.pdf')
    output_dir = os.path.join(script_dir, 'output')
    output_path = os.path.join(output_dir, f'utility_bill_{case_no}.pdf')

    pdf = pikepdf.open(input_path)
    total = 0

    # ── Page 1 processing ──
    page1 = pdf.pages[0]
    contents1 = page1.get('/Contents')
    streams1 = (
        [pdf.get_object(ref) for ref in contents1]
        if isinstance(contents1, pikepdf.Array)
        else [contents1]
    )

    for stream in streams1:
        raw = bytearray(stream.read_bytes())

        # Blank out original name
        blank_pattern_in_stream(raw, PAGE1_NAME_PATTERN)
        total += 1

        # Blank out original address lines
        for pattern in PAGE1_ADDR_PATTERNS:
            total += blank_pattern_in_stream(raw, pattern)

        # Replace account number
        total += replace_account_in_stream(raw, ORIGINAL_ACCOUNT, new_account)

        # Replace dates (same length DD.MM.YYYY = 10 chars)
        # IMPORTANT: Replace tempoh dates BEFORE tarikh_bil to avoid collision.
        # tarikh_bil (e.g. '01.03.2026') could match ORIG_TEMPOH_END and get
        # overwritten if tempoh_end is replaced after tarikh_bil.
        total += replace_string_in_stream(raw, ORIG_TEMPOH_START, vals['tempoh_start'])
        total += replace_string_in_stream(raw, ORIG_TEMPOH_END, vals['tempoh_end'])
        total += replace_string_in_stream(raw, ORIG_TARIKH_BIL, vals['tarikh_bil'])

        # Replace invoice number (same length 12 chars)
        total += replace_string_in_stream(raw, ORIG_INVOIS, vals['new_invois'])

        # Replace BAYARAN BAGI TEMPOH amount (pad to same length as original)
        new_bayaran_padded = vals['new_bayaran'].rjust(len(ORIG_BAYARAN))
        total += replace_string_in_stream(raw, ORIG_BAYARAN, new_bayaran_padded)

        # Replace deposit amount (pad to same length as original)
        new_deposit_padded = vals['new_deposit'].rjust(len(ORIG_DEPOSIT))
        total += replace_string_in_stream(raw, ORIG_DEPOSIT, new_deposit_padded)

        # Replace barcode invoice + tail digits
        total += replace_barcode_in_stream(raw, vals['new_invois'], vals['new_barcode_tail'])

        stream.write(bytes(raw))

    # Overlay masked name + address on page 1 (already formatted by normalizer)
    total += overlay_text(pdf, page1, addr_lines_p1, PAGE1_OVERLAY, is_name_first=True)

    # Replace annotations on page 1
    total += replace_in_annotations(page1, ORIGINAL_ACCOUNT, new_account)

    print(f'  Page 1: processed')

    # ── Page 2 processing ──
    page2 = pdf.pages[1]
    contents2 = page2.get('/Contents')
    streams2 = (
        [pdf.get_object(ref) for ref in contents2]
        if isinstance(contents2, pikepdf.Array)
        else [contents2]
    )

    for stream in streams2:
        raw = bytearray(stream.read_bytes())

        # Blank out original ALAMAT PREMIS address
        for pattern in PAGE2_ADDR_PATTERNS:
            total += blank_pattern_in_stream(raw, pattern)

        # Replace account number
        total += replace_account_in_stream(raw, ORIGINAL_ACCOUNT, new_account)

        # Replace dates on page 2 (tempoh bil, last payment date)
        total += replace_string_in_stream(raw, ORIG_TEMPOH_START, vals['tempoh_start'])
        total += replace_string_in_stream(raw, ORIG_TEMPOH_END, vals['tempoh_end'])
        total += replace_string_in_stream(raw, ORIG_LAST_PAYMENT_DATE, vals['last_payment_date'])

        # Replace BAYARAN amount on page 2
        new_bayaran_padded = vals['new_bayaran'].rjust(len(ORIG_BAYARAN))
        total += replace_string_in_stream(raw, ORIG_BAYARAN, new_bayaran_padded)

        stream.write(bytes(raw))

    # Overlay masked address on page 2 (ALAMAT PREMIS — already formatted by normalizer)
    total += overlay_text(pdf, page2, addr_lines_p2, PAGE2_OVERLAY)

    # Replace annotations on page 2
    total += replace_in_annotations(page2, ORIGINAL_ACCOUNT, new_account)

    print(f'  Page 2: processed')

    # ── Embed fonts for consistent rendering across viewers ──
    embedded = embed_fonts(pdf)
    print(f'  Fonts embedded: {embedded}')

    # ── Save output ──
    os.makedirs(output_dir, exist_ok=True)
    pdf.save(output_path)
    pdf.close()

    print(f'\nTotal: {total} replacements/overlays')
    print(f'  Account      : {ORIGINAL_ACCOUNT} -> {new_account}')
    print(f'  Invois       : {ORIG_INVOIS} -> {vals["new_invois"]}')
    print(f'  Tarikh Bil   : {vals["tarikh_bil"]}')
    print(f'  Tempoh Bil   : {vals["tempoh_start"]} - {vals["tempoh_end"]}')
    print(f'  Deposit      : RM{vals["new_deposit"]}')
    print(f'  Barcode tail : {vals["new_barcode_tail"]}')
    print(f'Saved to: {output_path}')


if __name__ == '__main__':
    main()
