"""The residence Address field's own validator, pinned by a live probe.

The portal's "Enter Address" modal marks its Address input `n-invalid` when the
value contains CONSECUTIVE WHITESPACE — and nothing else we could find. Probed
live on 2026-08-17 against the real dealer portal:

    INVALID  len= 68  "8 JALAN OKID 3 -  TAMAN ORKID 2 …"   (double space)
    valid    len= 67  same string, whitespace collapsed
    valid    len= 30  "8 JALAN OKID 3 - TAMAN ORKID 2"      (hyphen is fine)
    INVALID  len= 29  "8 JALAN OKID 3  TAMAN ORKID 2"       (double space alone)
    valid    len=105  "A"*100 and a real 105-char address   (length is fine)

An invalid value does not throw: OK silently leaves the residence address EMPTY
and raises a page-level "Some errors exist in this page." Warning that then
covers the form, so the failure surfaces ~60s later as an unrelated combobox
timeout. Hence both the normaliser and the post-OK emptiness check.

Run:  scraper/venv/bin/python tests/test_address_line.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from order_entry import normalize_address_line  # noqa: E402

CHECKS = 0
FAILED = []


def check(label, got, want):
    global CHECKS
    CHECKS += 1
    if got != want:
        FAILED.append(f"{label}: got {got!r}, want {want!r}")


# The exact string that failed live (draft cmsx1bnw9002lbdotf5iujdo6).
LIVE_FAILURE = "8 JALAN OKID 3 -  TAMAN ORKID 2 SIMPANG RENGGAM JOHOR MALAYSIA 86200"

check("the live failure collapses",
      normalize_address_line(LIVE_FAILURE),
      "8 JALAN OKID 3 - TAMAN ORKID 2 SIMPANG RENGGAM JOHOR MALAYSIA 86200")
check("no consecutive whitespace survives",
      "  " in normalize_address_line(LIVE_FAILURE), False)

check("double space", normalize_address_line("A  B"), "A B")
check("triple space", normalize_address_line("A   B"), "A B")
check("tab", normalize_address_line("A\tB"), "A B")
check("newline", normalize_address_line("A\nB"), "A B")
check("mixed run", normalize_address_line("A \t \n B"), "A B")
check("leading/trailing", normalize_address_line("  A B  "), "A B")
check("non-breaking space", normalize_address_line("A  B"), "A B")

# Values the live probe accepted must pass through unchanged.
check("single-spaced is untouched",
      normalize_address_line("8 JALAN OKID 3 - TAMAN ORKID 2"),
      "8 JALAN OKID 3 - TAMAN ORKID 2")
check("hyphens are not the problem",
      normalize_address_line("A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7"),
      "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7")
check("commas survive", normalize_address_line("NO 3, JALAN 5"), "NO 3, JALAN 5")
check("length is not truncated", len(normalize_address_line("A" * 200)), 200)

check("empty", normalize_address_line(""), "")
check("only spaces", normalize_address_line("   "), "")
check("None", normalize_address_line(None), "")

if FAILED:
    print(f"✗ {len(FAILED)}/{CHECKS} failed")
    for f in FAILED:
        print("   ", f)
    sys.exit(1)
print(f"✓ {CHECKS} checks passed")
