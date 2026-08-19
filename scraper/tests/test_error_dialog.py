"""Exercise READ_ERROR_DIALOG_JS + oe_errors classification against fixtures.

Why this exists: the portal's out-of-stock refusal ("[40300338]: Sorry, the
SAMSUNG TV 55" is currently out of stock.") fires AFTER the order number is
minted, so every wrong guess about the dialog's markup costs a real, chargeable,
stranded order. The exact shape it renders in is still unconfirmed live, so the
reader is tested against BOTH candidate shapes:

  * the in-iframe jQuery-UI dialog the portal uses for its other validations;
  * the shell modal in the agent's screenshot — outside #myIframe, no error-ish
    class, identifiable only by its "[code]:" body prefix.

Run:  scraper/venv/bin/python tests/test_error_dialog.py
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from oe_errors import (  # noqa: E402
    DEVICE_OUT_OF_STOCK,
    LOGIN_ID_TAKEN,
    UNKNOWN_ERROR,
    map_error,
    portal_code,
)
from oe_feasibility import (  # noqa: E402
    READ_ERROR_DIALOG_JS,
    blocked_next_error,
    classify_dialog,
)

HERE = pathlib.Path(__file__).parent
UIDIALOG = HERE / "fixtures" / "fixture_stock_dialog_uidialog.html"
SHELL = HERE / "fixtures" / "fixture_stock_dialog_shell.html"

# The in-iframe fixture has to be loaded through an #myIframe exactly as the
# portal does. srcdoc, not src: a file:// iframe is a separate origin, so
# contentDocument comes back null and the JS cannot see in at all.
HOST = """<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>
<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>"""

failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def in_iframe(fixture: pathlib.Path) -> str:
    html = fixture.read_text()
    return HOST.replace("FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;"))


# ── Pure classification: no browser needed ──────────────────────────────────
def test_mapping() -> None:
    print("\nMessage → code:")
    stock = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.'
    check("out-of-stock maps to its own code", map_error(stock) == DEVICE_OUT_OF_STOCK,
          map_error(stock))
    check("portal code extracted", portal_code(stock) == "40300338", str(portal_code(stock)))
    check("wording variants also map",
          map_error("There is no stock for this item.") == DEVICE_OUT_OF_STOCK)

    # The neighbouring failure on the same Next must NOT be swallowed by the new
    # rule — this is the regression that would silently mis-advise the agent to
    # change a device when the real problem was a username collision.
    login = ("RESERVELOGIN error. [1]:LOGIN_ID [tklee812@iptv] already in use "
             "by other customer")
    check("login collision still maps to login_id_taken",
          map_error(login) == LOGIN_ID_TAKEN, map_error(login))

    check("unmapped stays unknown", map_error("Something else entirely") == UNKNOWN_ERROR)
    check("no bracketed code → None", portal_code("plain message") is None)
    check("a short bracket is not a code", portal_code("[1]:LOGIN_ID") is None,
          str(portal_code("[1]:LOGIN_ID")))

    # classify_dialog omits `error` when nothing matched, so callers keep their
    # own stage-specific fallback instead of a blanket "unknown_error".
    unmapped = classify_dialog({"message": "Please select one offer.", "title": "Warning",
                                "selector": ".ui-dialog", "container": "iframe"})
    check("unmapped dialog carries no error key", "error" not in unmapped, str(unmapped))
    classified = classify_dialog({"message": stock, "title": "Error",
                                  "selector": ".modal.in", "container": "top"})
    check("classified dialog carries code + portal_code",
          classified.get("error") == DEVICE_OUT_OF_STOCK
          and classified.get("portal_code") == "40300338", str(classified))


def test_pay_tail() -> None:
    """The bail-out that the live run actually hit.

    A real submit died here with stage `pay` and the message "Next #1 on the way
    to Pay did not advance — the portal said: '[40300338]: …out of stock'. Page
    state: {…}" — the classification existed one call up and was discarded.
    """
    print("\nPay-tail Next blocked:")
    stock = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.'
    state = {"attachments": 3}

    nx = {"status": "warning", "stage": "next", "message": stock,
          "error": DEVICE_OUT_OF_STOCK, "portal_code": "40300338"}
    out = blocked_next_error(nx, 1, state, "shot.png")
    check("classification survives the pay tail",
          out["error"] == DEVICE_OUT_OF_STOCK, out["error"])
    check("message is the portal's verbatim sentence", out["message"] == stock,
          out["message"])
    check("page-state dump stays OUT of the agent's message",
          "Page state" not in out["message"])
    check("portal code passed up", out.get("portal_code") == "40300338")

    # Unclassified must keep the old debug-heavy behaviour — that dump is the
    # most useful thing we have when we cannot name the cause.
    plain = {"status": "warning", "message": "Please tick the acknowledgement."}
    out = blocked_next_error(plain, 2, state, None)
    check("unclassified still reports pay_tail_next_blocked",
          out["error"] == "pay_tail_next_blocked", out["error"])
    check("unclassified keeps the page-state dump", "Page state" in out["message"])
    check("unclassified names which Next", "Next #2" in out["message"])


async def main() -> int:
    test_mapping()
    test_pay_tail()

    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1192, "height": 716})

        # ── Shape 1: jQuery-UI dialog inside #myIframe ──────────────────────
        print("\nIn-iframe .ui-dialog:")
        await page.set_content(in_iframe(UIDIALOG))
        await page.wait_for_function(
            "() => { const f=document.querySelector('#myIframe');"
            " return f && f.contentDocument && f.contentDocument.querySelector('#stock'); }")

        dlg = await page.evaluate(READ_ERROR_DIALOG_JS, r"offer")
        print(f"  read: {dlg}")
        check("found a dialog", bool(dlg))
        if dlg:
            check("read the stock message, not the Offer picker",
                  "out of stock" in dlg["message"].lower(), dlg["message"])
            check("reported where it came from",
                  dlg["container"] == "iframe" and dlg["selector"] == ".ui-dialog",
                  f"{dlg['container']}/{dlg['selector']}")
            check("classified as out of stock",
                  classify_dialog(dlg).get("error") == DEVICE_OUT_OF_STOCK)
            # The hidden dialog carries a different code; picking it would mean
            # the visibility test failed.
            check("skipped the hidden dialog", "99999999" not in dlg["message"])
            check("clicked OK (dialog dismissed)",
                  await page.evaluate(
                      "() => document.querySelector('#myIframe').contentDocument"
                      ".querySelector('#stock').style.display === 'none'"))

        # ── Shape 2: shell modal outside the iframe ─────────────────────────
        print("\nTop-document shell modal (the screenshot's shape):")
        await page.set_content(SHELL.read_text())
        await page.wait_for_selector("#stock")

        dlg = await page.evaluate(READ_ERROR_DIALOG_JS, r"offer")
        print(f"  read: {dlg}")
        check("found the shell modal", bool(dlg))
        if dlg:
            check("read its message", "out of stock" in dlg["message"].lower(), dlg["message"])
            check("reported the top document", dlg["container"] == "top", dlg["container"])
            check("classified as out of stock",
                  classify_dialog(dlg).get("error") == DEVICE_OUT_OF_STOCK)
            check("portal code survives the read",
                  classify_dialog(dlg).get("portal_code") == "40300338")
            check("clicked OK (modal dismissed)",
                  await page.evaluate(
                      "() => document.querySelector('#stock').style.display === 'none'"))

        # ── Nothing up: must return None, not a false positive ──────────────
        print("\nNo dialog:")
        await page.set_content("<!doctype html><div>Customer Order Information</div>")
        check("returns null on a clean page",
              await page.evaluate(READ_ERROR_DIALOG_JS, r"offer") is None)

        await browser.close()

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'All checks passed.'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))


# ── Address served only by other operators (ORD-0006, 2026-08-19) ──────────
# The portal blocked the whole Feasibility Check behind an Error dialog while
# the offer grid sat populated behind it, so the run saw a correct offer row
# highlighted, `.js-orderNow` still carrying `hide`, and no reason why.

NO_TM = ("This address only offers services from other operators and does not "
         "have any services provided by TM.")


def test_an_address_with_no_tm_service_is_its_own_code():
    from oe_errors import ADDRESS_NO_TM_SERVICE, map_error
    assert map_error(NO_TM) == ADDRESS_NO_TM_SERVICE


def test_it_is_not_confused_with_an_address_that_already_has_service():
    """Opposite meanings and opposite advice: one says move the customer to a
    different address, the other says the line is already there. The portal's
    unserved-address sentence contains the words "services provided by TM", so
    rule order is the only thing keeping these apart."""
    from oe_errors import (ADDRESS_ALREADY_HAS_SERVICE, ADDRESS_NO_TM_SERVICE,
                           map_error)
    assert map_error(NO_TM) == ADDRESS_NO_TM_SERVICE
    assert map_error("This address already has TM service.") == ADDRESS_ALREADY_HAS_SERVICE
    assert ADDRESS_NO_TM_SERVICE != ADDRESS_ALREADY_HAS_SERVICE
