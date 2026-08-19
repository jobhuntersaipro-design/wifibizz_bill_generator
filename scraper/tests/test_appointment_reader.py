"""Exercise _APPT_READ_JS against Appointment-dialog fixtures.

Why this exists: the slot reader was observable ONLY by running a real submit,
and the appointment step mints an order before it runs — so every wrong guess
about the calendar's markup cost a genuine order that then had to be voided by
hand. Two are outstanding from precisely that loop.

The fixtures cover both FullCalendar shapes (events nested in their day cells,
and events in a separate absolutely-positioned layer), an empty day, and a
hidden event, so a selector or matcher change that breaks either one fails here
instead of in production.

Run:  scraper/venv/bin/python tests/test_appointment_reader.py
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from appointment_policy import choose_slot, describe_read_failure  # noqa: E402
from oe_feasibility import _APPT_READ_JS, _TAG_SLOT_JS as TAG_JS  # noqa: E402

HERE = pathlib.Path(__file__).parent
MODERN = HERE / "fixtures" / "fixture_appointment_dialog.html"
LEGACY = HERE / "fixtures" / "fixture_appointment_dialog_legacy.html"

# The real read happens inside the portal's #myIframe, and the JS walks that
# boundary — so the fixture is loaded the same way. srcdoc, not src: a file://
# iframe is a separate origin and `contentDocument` comes back null.
HOST = """<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>
<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>"""


def host_page(fixture: pathlib.Path) -> str:
    html = fixture.read_text()
    return HOST.replace("FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;"))


failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


async def read(page, fixture: pathlib.Path) -> dict:
    await page.set_content(host_page(fixture))
    await page.wait_for_function(
        "() => { const f=document.querySelector('#myIframe');"
        " return f && f.contentDocument && f.contentDocument.querySelector('.ui-dialog'); }")
    return await page.evaluate(_APPT_READ_JS)


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1192, "height": 716})

        # ── Modern: events nested inside their day cells ─────────────────────
        d = await read(page, MODERN)
        print(f"\nmodern: {d}\n")
        check("found the Appointment dialog, not the warning one", d["dialog"] is True)
        check("reports the day selector that matched",
              d["daySelector"] == ".fc-daygrid-day[data-date]", str(d["daySelector"]))
        check("reports the event selector that matched",
              d["eventSelector"] == ".fc-daygrid-event", str(d["eventSelector"]))
        check("counted all three day cells including the empty one",
              d["dayCells"] == 3, str(d["dayCells"]))
        check("the hidden event is not counted", d["events"] == 6, str(d["events"]))
        check("matched structurally, not by geometry",
              d["matchedBy"] == "contains", str(d["matchedBy"]))
        check("nothing went unmatched", d["unmatched"] == 0, str(d["unmatched"]))
        check("every event mapped to the right date", d["slots"] == [
            "2026-08-30 09:30:00", "2026-08-30 14:30:00",
            "2026-08-31 09:30:00", "2026-08-31 12:00:00",
            "2026-08-31 14:30:00", "2026-08-31 17:00:00",
        ], str(d["slots"]))
        check("an HH:MM event is normalised to HH:MM:SS",
              "2026-08-31 09:30:00" in d["slots"])
        check("the empty day contributes nothing",
              not any(s.startswith("2026-08-29") for s in d["slots"]))
        check("samples record the real markup for a live diagnosis",
              bool(d["samples"]) and "fc-daygrid-event" in d["samples"][0]["cls"],
              str(d["samples"][:1]))

        # The end-to-end point of the phase: the reader's output feeds the
        # policy, and 31 Aug must come back as 09:30.
        picked = choose_slot(d["slots"], {"strategy": "fixed_date",
                                          "fixed_date": "2026-08-31"})
        check("fixed_date 31 Aug books 09:30 from a real calendar read",
              picked.get("slot") == "2026-08-31 09:30:00", str(picked))

        # ── Legacy: events in a layer over the grid ──────────────────────────
        d = await read(page, LEGACY)
        print(f"\nlegacy: {d}\n")
        check("falls back to .fc-day when .fc-daygrid-day is absent",
              d["daySelector"] == ".fc-day[data-date]", str(d["daySelector"]))
        check("falls back to the geometric hit-test",
              d["matchedBy"] == "geometry", str(d["matchedBy"]))
        check("the hidden event is not counted here either",
              d["events"] == 7, str(d["events"]))
        check("events map to the day cell they sit over", d["slots"] == [
            "2026-08-30 09:30:00", "2026-08-30 14:30:00",
            "2026-08-31 09:30:00", "2026-08-31 12:00:00",
            "2026-08-31 17:00:00",
            "2026-09-06 09:30:00", "2026-09-07 14:30:00",
        ], str(d["slots"]))
        check("nothing went unmatched", d["unmatched"] == 0, str(d["unmatched"]))
        # THE REGRESSION THAT COST A REAL BOOKING. Week 2's events sit 8px below
        # week 1's cells — inside the slop the old corner matcher allowed — so it
        # dated them to August and the portal booked a week later than intended.
        check("week 2's events are NOT dated to the row above",
              not any(s.startswith("2026-08-3") and s.endswith("09:30:00")
                      and s == "2026-08-30 09:30:00" and d["slots"].count(s) > 1
                      for s in d["slots"])
              and "2026-09-06 09:30:00" in d["slots"],
              str(d["slots"]))

        # ── The tagger marks the event that will actually be CLICKED ─────────
        # Booking works by clicking the calendar event, so tagging the wrong one
        # books the wrong date silently — which is exactly what happened live.
        # Week 2 is the case that broke: its events sit just below week 1's row.
        for want, expect_top in (("2026-09-06 09:30:00", True),
                                 ("2026-08-30 09:30:00", False)):
            ok = await page.evaluate(TAG_JS, want)
            info = await page.evaluate("""() => {
              const d=document.querySelector('#myIframe').contentDocument;
              const e=d.querySelector('[data-oe-appt]');
              if(!e) return null;
              const r=e.getBoundingClientRect();
              return {text:(e.innerText||'').trim(), top:Math.round(r.top)};
            }""")
            check(f"tagged exactly one event for {want}", bool(ok) and info is not None,
                  str(info))
            if info:
                in_week2 = info["top"] > 100
                check(f"{want} tagged in the correct week row",
                      in_week2 == expect_top,
                      f"top={info['top']} text={info['text']!r}")

        ok = await page.evaluate(TAG_JS, "2026-09-06 03:00:00")
        check("a slot the calendar does not offer tags nothing", not ok)

        # ── The failure causes, told apart ───────────────────────────────────
        # A genuinely empty calendar: day cells, no events.
        await page.set_content(host_page(MODERN))
        await page.wait_for_function(
            "() => { const f=document.querySelector('#myIframe');"
            " return f && f.contentDocument && f.contentDocument.querySelector('.fc-event'); }")
        await page.evaluate("""() => {
          const d = document.querySelector('#myIframe').contentDocument;
          d.querySelectorAll('.fc-event').forEach(e => e.remove());
        }""")
        d = await page.evaluate(_APPT_READ_JS)
        check("an empty calendar still reports its day cells",
              d["dayCells"] == 3 and d["events"] == 0, str(d))
        check("…and is reported as an empty calendar, not a broken reader",
              describe_read_failure(d) == "the portal offered no slots",
              describe_read_failure(d))

        # No dialog at all.
        await page.set_content(HOST.replace("FIXTURE_HTML", "<p>nothing here</p>"))
        d = await page.evaluate(_APPT_READ_JS)
        check("no dialog is its own cause",
              d["dialog"] is False
              and describe_read_failure(d) == "the appointment dialog did not open",
              describe_read_failure(d))

        # Dialog present, but the day-cell markup is unrecognised — the exact
        # failure this whole phase exists to make visible.
        await page.set_content(host_page(MODERN))
        await page.wait_for_function(
            "() => { const f=document.querySelector('#myIframe');"
            " return f && f.contentDocument && f.contentDocument.querySelector('[data-date]'); }")
        await page.evaluate("""() => {
          const d = document.querySelector('#myIframe').contentDocument;
          d.querySelectorAll('[data-date]').forEach(e => e.removeAttribute('data-date'));
        }""")
        d = await page.evaluate(_APPT_READ_JS)
        check("unreadable day cells are reported as unreadable, NOT as no slots",
              d["dayCells"] == 0 and "day cells not found" in describe_read_failure(d),
              describe_read_failure(d))

        await browser.close()

    print(f"\n{len(failures)} failed" if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
