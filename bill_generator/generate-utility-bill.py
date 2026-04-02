import pikepdf
import random
import os
import sys
import psycopg2
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

# ── Fetch customer data from Neon DB ──────────────────────────────
def fetch_case(case_no):
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


# ── Original values (from the source PDF) ──────────────────────────
ORIGINAL_ACCOUNT = '30549703647'
ORIGINAL_BILL_DIGITS = '2025020998273681'  # YYYYMMDD + 8 random

# Original dates as digit sequences (DDMMYYYY as they appear in DD/MM/YYYY)
ORIG_BILL_DATE = '09022025'       # 09/02/2025
ORIG_PERIOD_START = '09012025'    # 09/01/2025
ORIG_PERIOD_END = '08022025'      # 08/02/2025
ORIG_DUE_DATE = '08032025'        # 08/03/2025
ORIG_PAYMENT_DATE = '23012025'    # 23/01/2025
ORIG_PAYMENT_TIME = '151229'      # 15:12:29

# Original mobile number (page 2)
ORIGINAL_MOBILE = '601135992046'  # 6011 359 92046

# Original name and address positions on page 1 (for white-out overlay)
# Name: "Mr FOO GUAN ZHENG" at y=646.75, x starts at 48.024
# Address line 1: "30 JALAN BELIMBING INDAH D'BOULEVARD" at y=635.95, x=48.024
# Address line 2: "43300 SERI KEMBANGAN SELANGOR MALAYSIA" at y=624.91, x=48.024
NAME_ADDR_OVERLAY = {
    'x': 48.024,
    'name_y': 646.75,
    'addr1_y': 635.95,
    'addr2_y': 624.91,
    'box_x': 44,        # white-out box left edge
    'box_y': 621,       # white-out box bottom (below addr2 baseline)
    'box_w': 290,       # wide enough for long names but stops before right column (x=343)
    'box_h': 36,        # tall enough to cover name top (646.75 + ~8pt font = ~655)
    'font_size': 7.92,
}

# Original TJ byte patterns to blank out (replace chars with spaces)
# These are the exact TJ arrays from the template PDF stream
BLANK_TJ_PATTERNS = [
    # MCID 5: "M"
    b'[(M)] TJ',
    # MCID 6: "r FOO GUAN ZHENG"
    b'[(r)-9( )-6(F)-44(O)-20(O)-48( )-6(G)-48(U)-19(A)-47(N)-19( )-6(Z)-44(H)-19(E)-45(N)-19(G)] TJ',
    # MCID 8 addr line 1: "30 JALAN BELIMBING INDAH D'BOULEVARD "
    b"[(3)-11(0)-11( )-5(J)-39(A)-14(L)-40(A)-14(N)-16( )-33(B)-14(E)-14(L)-40(I)-5(M)-47(B)-14(I)-5(N)-44(G)-16( )-5(I)-33(N)-16(D)-16(A)-42(H)-16( )-33(D)-16(')-7(B)-42(O)-16(U)-16(L)-40(E)-14(V)-42(A)-14(R)-44(D)-16( )] TJ",
    # MCID 8 addr line 2: "43300 SERI KEMBANGAN SELANGOR MALAYSIA"
    b'[(4)-11(3)-11(3)-11(0)-40(0)-11( )-33(S)-14(E)-14(R)-44(I)-5( )-5(K)-42(E)-14(M)-47(B)-14(A)-42(N)-16(G)-16(A)-42(N)-16( )-33(S)-14(E)-14(L)-40(A)-14(N)-44(G)-16(O)-45(R)-16( )-33(M)-18(A)-14(L)-40(A)-14(Y)-42(S)-14(I)-5(A)] TJ',
]


def blank_tj_pattern(pattern):
    """Replace all printable chars inside (...) with spaces, preserving byte count."""
    result = bytearray(pattern)
    i = 0
    while i < len(result):
        if result[i] == 0x28:  # '('
            j = i + 1
            while j < len(result) and result[j] != 0x29:  # ')'
                if result[j] != 0x5C:  # not backslash escape
                    result[j] = 0x20  # space
                j += 1
            i = j + 1
        else:
            i += 1
    return bytes(result)


def compute_values(customer_mobile):
    """Compute all randomized replacement values, using customer mobile from DB."""
    today = date.today()

    # T-1 month
    bill_m = today.month - 1 if today.month > 1 else 12
    bill_y = today.year if today.month > 1 else today.year - 1

    # Bill date: random day 3-9 of T-1 month
    bill_day = random.randint(3, 9)
    bill_date = date(bill_y, bill_m, bill_day)

    # Bill period: bill_day of (T-2 months) to (bill_day-1) of (T-1 month)
    ps_m = bill_m - 1 if bill_m > 1 else 12
    ps_y = bill_y if bill_m > 1 else bill_y - 1
    period_start = date(ps_y, ps_m, bill_day)
    period_end = date(bill_y, bill_m, bill_day - 1)

    # Due date: (bill_day-1) of T (one month after bill period end)
    due_date = date(today.year, today.month, bill_day - 1)

    # Random payment date within the bill period
    pay_days = (period_end - period_start).days
    payment_date = period_start + timedelta(days=random.randint(0, pay_days))

    # Random payment time between 10:00:00 and 15:59:59
    pay_h = random.randint(10, 15)
    pay_m = random.randint(0, 59)
    pay_s = random.randint(0, 59)

    def ddmmyyyy(d):
        return f'{d.day:02d}{d.month:02d}{d.year}'

    def yyyymmdd(d):
        return f'{d.year}{d.month:02d}{d.day:02d}'

    new_account = ''.join([str(random.randint(0, 9)) for _ in range(11)])
    new_bill_suffix = ''.join([str(random.randint(0, 9)) for _ in range(8)])
    new_bill_digits = yyyymmdd(bill_date) + new_bill_suffix

    # Use customer mobile from DB — strip leading '+' and ensure 12 digits
    mobile_digits = customer_mobile.lstrip('+')
    if len(mobile_digits) < 12:
        mobile_digits = mobile_digits.ljust(12, '0')
    elif len(mobile_digits) > 12:
        mobile_digits = mobile_digits[:12]
    new_mobile = mobile_digits

    new_bill_date = ddmmyyyy(bill_date)
    new_period_start = ddmmyyyy(period_start)
    new_period_end = ddmmyyyy(period_end)
    new_due_date = ddmmyyyy(due_date)
    new_payment_date = ddmmyyyy(payment_date)
    new_payment_time = f'{pay_h:02d}{pay_m:02d}{pay_s:02d}'

    return {
        'new_account': new_account,
        'new_bill_digits': new_bill_digits,
        'new_mobile': new_mobile,
        'new_bill_date': new_bill_date,
        'new_period_start': new_period_start,
        'new_period_end': new_period_end,
        'new_due_date': new_due_date,
        'new_payment_date': new_payment_date,
        'new_payment_time': new_payment_time,
        'bill_date': bill_date,
        'period_start': period_start,
        'period_end': period_end,
        'due_date': due_date,
        'payment_date': payment_date,
    }

def split_address(full_address):
    """Split a full address into two lines matching the template layout.

    Template format:
      Line 1: street address (e.g. "NO 12 JALAN MERPATI 3 TAMAN BUKIT INDAH")
      Line 2: postcode + city + state (e.g. "81200 JOHOR BAHRU JOHOR")

    Handles two common formats:
      - Postcode in middle: "... TAMAN BUKIT INDAH 81200 JOHOR BAHRU"
      - Postcode at end: "... LAHAD DATU SABAH MALAYSIA 91100"
    """
    import re
    # Clean up: replace commas with spaces, collapse whitespace
    addr = re.sub(r',\s*', ' ', full_address).strip()
    addr = re.sub(r'\s+', ' ', addr)

    # Find all 5-digit postcode patterns (skip leading numbers like house/lot no)
    matches = list(re.finditer(r'\b(\d{5})\b', addr))

    if matches:
        # Use the last 5-digit number as the postcode
        # (first digits are often house/lot numbers like "99347292")
        postcode_match = matches[-1]
        postcode_pos = postcode_match.start()
        postcode_end = postcode_match.end()

        # Check if postcode is at the end of the address
        after_postcode = addr[postcode_end:].strip()
        if not after_postcode:
            # Postcode at end — line 2 needs to be built differently
            # Find a sensible split point before the postcode
            before = addr[:postcode_pos].strip()
            # Try to find state/city keywords to split at
            # Look for the last occurrence of common separators
            # Split roughly: keep street on line 1, city/state/postcode on line 2
            words = before.split()
            # Find where the "city" part starts — heuristic: after TAMAN/KAMPUNG etc.
            # or just split at roughly half
            mid = len(words) // 2
            line1 = ' '.join(words[:mid])
            line2 = ' '.join(words[mid:]) + ' ' + addr[postcode_pos:postcode_end]
        else:
            # Postcode in middle — standard format
            line1 = addr[:postcode_pos].strip()
            line2 = addr[postcode_pos:].strip()
    else:
        # No postcode found — split at roughly half
        mid = len(addr) // 2
        space = addr.find(' ', mid)
        if space == -1:
            space = addr.rfind(' ', 0, mid)
        if space == -1:
            line1 = addr
            line2 = ''
        else:
            line1 = addr[:space].strip()
            line2 = addr[space:].strip()

    return line1, line2


def build_replacements(v):
    """Build stream and text replacement lists from computed values."""
    stream_replacements = [
        (ORIGINAL_BILL_DIGITS, v['new_bill_digits']),
        (ORIGINAL_ACCOUNT, v['new_account']),
        (ORIG_BILL_DATE, v['new_bill_date']),
        (ORIG_PERIOD_START, v['new_period_start']),
        (ORIG_PERIOD_END, v['new_period_end']),
        (ORIG_DUE_DATE, v['new_due_date']),
        (ORIG_PAYMENT_DATE, v['new_payment_date']),
        (ORIG_PAYMENT_TIME, v['new_payment_time']),
        (ORIGINAL_MOBILE, v['new_mobile']),
    ]

    text_replacements = [
        ('INV' + ORIGINAL_BILL_DIGITS, 'INV' + v['new_bill_digits']),
        (ORIGINAL_ACCOUNT, v['new_account']),
        (ORIG_BILL_DATE[:4] + '/' + ORIG_BILL_DATE[4:6] + '/' + ORIG_BILL_DATE[6:],
         v['new_bill_date'][:2] + '/' + v['new_bill_date'][2:4] + '/' + v['new_bill_date'][4:]),
        (ORIG_PERIOD_START[:4] + '/' + ORIG_PERIOD_START[4:6] + '/' + ORIG_PERIOD_START[6:],
         v['new_period_start'][:2] + '/' + v['new_period_start'][2:4] + '/' + v['new_period_start'][4:]),
        (ORIG_PERIOD_END[:4] + '/' + ORIG_PERIOD_END[4:6] + '/' + ORIG_PERIOD_END[6:],
         v['new_period_end'][:2] + '/' + v['new_period_end'][2:4] + '/' + v['new_period_end'][4:]),
        (ORIG_DUE_DATE[:4] + '/' + ORIG_DUE_DATE[4:6] + '/' + ORIG_DUE_DATE[6:],
         v['new_due_date'][:2] + '/' + v['new_due_date'][2:4] + '/' + v['new_due_date'][4:]),
        (ORIG_PAYMENT_DATE[:4] + '/' + ORIG_PAYMENT_DATE[4:6] + '/' + ORIG_PAYMENT_DATE[6:],
         v['new_payment_date'][:2] + '/' + v['new_payment_date'][2:4] + '/' + v['new_payment_date'][4:]),
        (ORIG_PAYMENT_TIME[:2] + ':' + ORIG_PAYMENT_TIME[2:4] + ':' + ORIG_PAYMENT_TIME[4:],
         v['new_payment_time'][:2] + ':' + v['new_payment_time'][2:4] + ':' + v['new_payment_time'][4:]),
        (ORIGINAL_MOBILE, v['new_mobile']),
    ]

    return stream_replacements, text_replacements


# ── PDF stream digit-sequence replacement engine ───────────────────
def collect_digit_positions(data):
    """Collect byte offsets of all digits inside (...) PDF string literals."""
    positions = []
    i = 0
    length = len(data)
    while i < length:
        if data[i] == 0x28:  # '('
            depth = 1
            j = i + 1
            while j < length and depth > 0:
                b = data[j]
                if b == 0x28 and data[j - 1] != 0x5C:
                    depth += 1
                elif b == 0x29 and data[j - 1] != 0x5C:
                    depth -= 1
                j += 1
            for k in range(i + 1, j - 1):
                if 0x30 <= data[k] <= 0x39:
                    positions.append(k)
            i = j
        else:
            i += 1
    return positions


def replace_digit_sequence(buf, positions, old_str, new_str):
    """Find digit sequences matching old_str and replace with new_str in buf."""
    old_bytes = old_str.encode('ascii')
    new_bytes = new_str.encode('ascii')
    old_len = len(old_bytes)
    count = 0
    i = 0
    while i <= len(positions) - old_len:
        if all(buf[positions[i + d]] == old_bytes[d] for d in range(old_len)):
            for d in range(old_len):
                buf[positions[i + d]] = new_bytes[d]
            count += 1
            i += old_len
        else:
            i += 1
    return count


def process_stream(stream_bytes, stream_replacements, blank_patterns=None):
    """Apply all digit-sequence replacements to a PDF content stream."""
    buf = bytearray(stream_bytes)
    total = 0

    # Blank out original name/address TJ arrays (replace chars with spaces)
    if blank_patterns:
        for pattern in blank_patterns:
            blanked = blank_tj_pattern(pattern)
            idx = buf.find(pattern)
            if idx >= 0:
                buf[idx:idx + len(pattern)] = blanked
                total += 1

    for old_str, new_str in stream_replacements:
        positions = collect_digit_positions(buf)
        count = replace_digit_sequence(buf, positions, old_str, new_str)
        total += count
    return bytes(buf), total


def overlay_name_address(pdf, page, name, addr_line1, addr_line2):
    """Overlay new name and address text on page 1 using a standard font.

    Draws a white rectangle over the original name/address area, then
    writes new text using Helvetica-Bold (name) and Helvetica (address).
    """
    o = NAME_ADDR_OVERLAY
    fs = o['font_size']

    # Register Helvetica and Helvetica-Bold as page fonts
    resources = page['/Resources']
    fonts = resources['/Font']

    # Add standard fonts if not already present
    if '/FHB' not in fonts:
        fonts[pikepdf.Name('/FHB')] = pdf.make_indirect(pikepdf.Dictionary({
            '/Type': pikepdf.Name('/Font'),
            '/Subtype': pikepdf.Name('/Type1'),
            '/BaseFont': pikepdf.Name('/Helvetica-Bold'),
        }))
    if '/FH' not in fonts:
        fonts[pikepdf.Name('/FH')] = pdf.make_indirect(pikepdf.Dictionary({
            '/Type': pikepdf.Name('/Font'),
            '/Subtype': pikepdf.Name('/Type1'),
            '/BaseFont': pikepdf.Name('/Helvetica'),
        }))

    # Escape text for PDF string literal
    def esc(text):
        return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    # Build overlay content stream:
    # 1. White rectangle over original name/address
    # 2. New text using standard fonts
    overlay = (
        f'q\n'
        f'1 1 1 rg\n'  # white fill
        f'{o["box_x"]} {o["box_y"]} {o["box_w"]} {o["box_h"]} re f\n'
        f'Q\n'
        f'BT\n'
        f'/FHB {fs} Tf\n'
        f'0 g\n'
        f'{o["x"]} {o["name_y"]} Td\n'
        f'({esc("Mr " + name)}) Tj\n'
        f'ET\n'
        f'BT\n'
        f'/FH {fs} Tf\n'
        f'0 g\n'
        f'{o["x"]} {o["addr1_y"]} Td\n'
        f'({esc(addr_line1)}) Tj\n'
        f'ET\n'
        f'BT\n'
        f'/FH {fs} Tf\n'
        f'0 g\n'
        f'{o["x"]} {o["addr2_y"]} Td\n'
        f'({esc(addr_line2)}) Tj\n'
        f'ET\n'
    )

    # Append overlay as a new content stream
    overlay_stream = pdf.make_stream(overlay.encode('latin-1'))
    contents = page.get('/Contents')
    if isinstance(contents, pikepdf.Array):
        contents.append(overlay_stream)
    else:
        page[pikepdf.Name('/Contents')] = pikepdf.Array([contents, overlay_stream])

    return 3  # 3 text replacements (name + 2 address lines)


def replace_in_text(text, text_replacements):
    """Apply all plain-text replacements to a string (bookmarks, metadata)."""
    for old, new in text_replacements:
        text = text.replace(old, new)
    return text


# ── Main ───────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print('Usage: python generate-utility-bill.py <case_no>')
        print('Example: python generate-utility-bill.py 202624115')
        sys.exit(1)

    case_no = sys.argv[1]

    # Fetch customer data from Neon DB
    print(f'Fetching case {case_no} from database...')
    case = fetch_case(case_no)
    print(f'  Customer: {case["full_name"]}')
    print(f'  Address : {case["full_address"]}')
    print(f'  Mobile  : {case["mobile"]}')

    # Compute replacement values using customer mobile from DB
    v = compute_values(case['mobile'])
    stream_replacements, text_replacements = build_replacements(v)

    # Split address into two lines matching the template layout
    addr_line1, addr_line2 = split_address(case['full_address'])
    print(f'  Addr L1 : {addr_line1}')
    print(f'  Addr L2 : {addr_line2}')

    # Resolve paths relative to this script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(script_dir, 'template', 'internet_bill.pdf')
    output_dir = os.path.join(script_dir, 'output')
    output_path = os.path.join(output_dir, f'utility_bill_{case_no}.pdf')

    pdf = pikepdf.open(input_path)
    total = 0

    # Replace in page content streams
    for page_num, page in enumerate(pdf.pages):
        contents = page.get('/Contents')
        if contents is None:
            continue

        streams = (
            [pdf.get_object(ref) for ref in contents]
            if isinstance(contents, pikepdf.Array)
            else [contents]
        )

        page_count = 0
        for stream in streams:
            raw = stream.read_bytes()
            # Blank out original name/address on page 1 before digit replacement
            blanks = BLANK_TJ_PATTERNS if page_num == 0 else None
            modified, count = process_stream(raw, stream_replacements, blanks)
            if count > 0:
                stream.write(modified)
                page_count += count

        # Overlay name and address on page 1 using standard fonts
        if page_num == 0:
            overlay_count = overlay_name_address(
                pdf, page, case['full_name'], addr_line1, addr_line2
            )
            page_count += overlay_count

        if page_count:
            print(f'  Page {page_num + 1}: {page_count} replacement(s)')
            total += page_count

    # Replace in bookmarks/outlines
    if '/Outlines' in pdf.Root:
        def fix_outlines(obj):
            count = 0
            if isinstance(obj, pikepdf.Dictionary):
                if '/Title' in obj:
                    old_title = str(obj['/Title'])
                    new_title = replace_in_text(old_title, text_replacements)
                    if new_title != old_title:
                        obj['/Title'] = pikepdf.String(new_title)
                        count += 1
                for key in ('/First', '/Next', '/Last'):
                    if key in obj:
                        count += fix_outlines(obj[key])
            return count

        count = fix_outlines(pdf.Root['/Outlines'])
        if count:
            print(f'  Bookmarks: {count} replacement(s)')
            total += count

    # Replace in all string objects (metadata, annotations, etc.)
    for objnum in range(len(pdf.objects)):
        try:
            obj = pdf.objects.get(objnum)
            if isinstance(obj, pikepdf.Dictionary):
                for key in obj.keys():
                    val = obj[key]
                    if isinstance(val, pikepdf.String):
                        old_val = str(val)
                        new_val = replace_in_text(old_val, text_replacements)
                        if new_val != old_val:
                            obj[key] = pikepdf.String(new_val)
                            total += 1
        except Exception:
            pass

    os.makedirs(output_dir, exist_ok=True)
    pdf.save(output_path)
    pdf.close()

    print(f'\nTotal: {total} replacements')
    print(f'  Name         : FOO GUAN ZHENG -> {case["full_name"]}')
    print(f'  Address L1   : 30 JALAN BELIMBING INDAH D\'BOULEVARD -> {addr_line1}')
    print(f'  Address L2   : 43300 SERI KEMBANGAN SELANGOR MALAYSIA -> {addr_line2}')
    print(f'  Account      : {ORIGINAL_ACCOUNT} -> {v["new_account"]}')
    print(f'  Bill No      : INV{ORIGINAL_BILL_DIGITS} -> INV{v["new_bill_digits"]}')
    print(f'  Bill Date    : {ORIG_BILL_DATE} -> {v["new_bill_date"]}')
    print(f'  Period       : {ORIG_PERIOD_START} - {ORIG_PERIOD_END} -> {v["new_period_start"]} - {v["new_period_end"]}')
    print(f'  Due Date     : {ORIG_DUE_DATE} -> {v["new_due_date"]}')
    print(f'  Payment Date : {ORIG_PAYMENT_DATE} -> {v["new_payment_date"]}')
    print(f'  Payment Time : {ORIG_PAYMENT_TIME} -> {v["new_payment_time"]}')
    print(f'  Mobile No    : {ORIGINAL_MOBILE} -> {v["new_mobile"]}')
    print(f'Saved to: {output_path}')


if __name__ == '__main__':
    main()
