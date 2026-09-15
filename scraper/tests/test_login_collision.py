"""Detecting the portal's "this service login is already taken" rejection.

Seen live 2026-08-17 on the sub-product Next, as an Error dialog:

    [40330205]: Operate resource error, RESERVELOGIN error. [1]:LOGIN_ID
    [tklee812@iptv] provided in input is already in use by other customer...

The username is `email-local-part + 3 random digits`, i.e. only 900 candidates
per customer — and every failed attempt RESERVES one, so a customer resubmitted
a few times collides with its own earlier runs. Retrying with a fresh id is the
fix; recognising the message is what triggers the retry.

Matching must stay tight: a false positive would re-roll the service number in
response to an unrelated warning and hide the real problem.

Run:  scraper/venv/bin/python tests/test_login_collision.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from oe_feasibility import (  # noqa: E402
    _service_username,
    is_login_format_invalid,
    is_login_taken,
    taken_login_id,
)

CHECKS = 0
FAILED = []


def check(label, got, want):
    global CHECKS
    CHECKS += 1
    if got != want:
        FAILED.append(f"{label}: got {got!r}, want {want!r}")


LIVE = ("[40330205]: Operate resource error, RESERVELOGIN error. [1]:LOGIN_ID "
        "[tklee812@iptv] provided in input is already in use by other customer...")

# ── positives ───────────────────────────────────────────────────────────────
check("the live message", is_login_taken(LIVE), True)
check("extracts the login id", taken_login_id(LIVE), "tklee812@iptv")
check("RESERVELOGIN alone", is_login_taken("RESERVELOGIN error."), True)
check("plain already-in-use",
      is_login_taken("LOGIN_ID [x@unifi] is already in use by other customer"), True)
check("already taken", is_login_taken("This username is already taken."), True)
check("case insensitive", is_login_taken("reservelogin ERROR"), True)

# ── negatives: unrelated portal warnings must NOT trigger a re-roll ─────────
check("offer warning",
      is_login_taken("Please select one offer in the Smart Device group."), False)
check("incomplete data", is_login_taken("The data is incomplete."), False)
check("page errors",
      is_login_taken("Some errors exist in this page. Please check and input again."), False)
check("no slots", is_login_taken("no available slots found in the calendar"), False)
check("empty", is_login_taken(""), False)
check("None", is_login_taken(None), False)
check("no login id to extract", taken_login_id("The data is incomplete."), None)
check("None extract", taken_login_id(None), None)

# ── username generation ─────────────────────────────────────────────────────
u = _service_username("tklee@gmail.com")
check("prefix uppercased from the email local part", u.startswith("TKLEE"), True)
check("three digits appended", len(u), len("TKLEE") + 3)
check("alphanumeric only", u.isalnum(), True)
check("strips punctuation", _service_username("tk.lee+x@gmail.com").startswith("TKLEEX"), True)
check("empty email still yields a name", len(_service_username("")) > 0, True)
check("None email still yields a name", len(_service_username(None)) > 0, True)

# The retry must never re-offer a name this run already burned.
seen = {_service_username("tklee@gmail.com", exclude=set()) for _ in range(5)}
excluded = _service_username("tklee@gmail.com", exclude=seen)
check("exclude is honoured", excluded in seen, False)

# Excluding every candidate must still return something rather than hang.
allnames = {f"TKLEE{n}" for n in range(100, 1000)}
check("exhausted pool still returns a name",
      bool(_service_username("tklee@gmail.com", exclude=allnames)), True)

# ── the 21-character limit (live 2026-09-15, order 2609000125316868) ─────────
# Email local part `faizdarwisybinsuhaimi123` produced FAIZDARWISYBINSUHAIMI123393
# (27 chars); the portal's Check refused it and the Next then blocked with
# "Please check the service number first."
long_name = _service_username("faizdarwisybinsuhaimi123@gmail.com")
check("a long email never exceeds the portal's 21 characters", len(long_name) <= 21, True)
check("a long email keeps its leading letters", long_name.startswith("FAIZDARWISYBINSUHA"), True)
check("a long email still ends in the 3 random digits", long_name[-3:].isdigit(), True)
check("a short email is unchanged in shape", len(_service_username("tklee@gmail.com")), 8)

LIVE_FORMAT = "The format is illegal, cannot contain special characters, and the length cannot exceed 21"
check("the live format refusal is recognised", is_login_format_invalid(LIVE_FORMAT), True)
check("a format refusal is not a collision", is_login_taken(LIVE_FORMAT), False)
check("a collision is not a format refusal",
      is_login_format_invalid("RESERVELOGIN error. LOGIN_ID [x@iptv] is already in use"), False)
check("unrelated warnings are not format refusals",
      is_login_format_invalid("Please check the service number first."), False)
check("None is not a format refusal", is_login_format_invalid(None), False)

if FAILED:
    print(f"✗ {len(FAILED)}/{CHECKS} failed")
    for f in FAILED:
        print("   ", f)
    sys.exit(1)
print(f"✓ {CHECKS} checks passed")
