"""Installation Contact via the Add Mode dialog's **New Contact** (ClickUp z8v9xnj9m3).

The rule (Chris, 2026-10-22): always New Contact, never Select Existing, filled
from the order — Customer Name = the account name without its [number],
Customer Mobile = 60 + the number without its leading 60, Second Customer Mobile
blank, Customer Email = the order's email.

The New Contact form's markup has never been captured, so fields are found by
their LABEL (falling back to the names the customer-profile contact form uses)
and every field the dialog carries is printed to the run log.
"""

import re

# Topmost visible dialog in the portal iframe, stamped by identity so every
# later call (choose mode, fill, OK) addresses the SAME dialog.
_TAG_DIALOG_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
  const vis=e=>e&&e.offsetParent!==null;
  d.querySelectorAll('[data-bf-ic-dlg]').forEach(e=>e.removeAttribute('data-bf-ic-dlg'));
  const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
  const top=dlgs[dlgs.length-1]; if(!top) return 'nodialog';
  top.setAttribute('data-bf-ic-dlg','1'); return 'ok';
})()"""

# Pick "New Contact" in the tagged dialog: a radio/checkbox whose label says it,
# an <option>, or a clickable element whose whole text is "New Contact".
_CHOOSE_NEW_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
  const dlg=d.querySelector('[data-bf-ic-dlg]'); if(!dlg) return 'nodialog';
  const re=/^\s*new\s*contact\s*$/i, T=e=>((e&&(e.innerText||e.textContent))||'').trim();
  for (const inp of dlg.querySelectorAll('input[type=radio],input[type=checkbox]')) {
    const lab=inp.closest('label')||(inp.id&&dlg.querySelector('label[for="'+inp.id+'"]'));
    const txt=T(lab)||T(inp.nextSibling&&inp.nextSibling.nodeType===3?{textContent:inp.nextSibling.textContent}:inp.nextElementSibling)||inp.value;
    if (re.test(txt)) { if(!inp.checked) inp.click(); return 'radio'; }
  }
  for (const sel of dlg.querySelectorAll('select')) {
    const opt=[...sel.options].find(o=>re.test(o.text));
    if (opt) { sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return 'select'; }
  }
  const el=[...dlg.querySelectorAll('label,a,button,span,li,div')].find(e=>re.test(T(e)));
  if (el) { el.click(); return 'click'; }
  return 'notfound';
})()"""

# Every visible form-group in the tagged dialog: label + its controls, each
# control stamped data-bf-ic=<n> so Playwright can type into it.
_SCAN_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const dlg=d.querySelector('[data-bf-ic-dlg]'); if(!dlg) return null;
  const vis=e=>e&&e.offsetParent!==null;
  let n=0; const out=[];
  for (const g of dlg.querySelectorAll('.form-group')) {
    if (!vis(g)) continue;
    const lab=g.querySelector('label');
    const ctrls=[...g.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea')].filter(vis);
    if (!ctrls.length) continue;
    out.push({label: ((lab&&lab.innerText)||'').trim(),
              controls: ctrls.map(c=>{const id=String(n++); c.setAttribute('data-bf-ic',id);
                return {id, name: c.getAttribute('name')||'', value: c.value||''};})});
  }
  return out;
})()"""

FALLBACK_NAMES = {"name": ["contactManName", "contactName", "custName"],
                  "area": ["mobileAreaCode"], "phone": ["mobilePhone"],
                  "email": ["emailAddr", "email"]}


def split_mobile(prefix: str, mobile: str) -> tuple[str, str]:
    """(country code, number) for the portal's two mobile boxes.

    601127749539 -> ("60", "1127749539"). A number not starting with 60 does
    not crash: a local 0-leading number drops the 0 and takes 60; anything else
    is kept whole under the order's own prefix (default 60).
    """
    digits = re.sub(r"\D", "", mobile or "")
    if digits.startswith("60"):
        return "60", digits[2:]
    if digits.startswith("0"):
        return "60", digits[1:]
    return (re.sub(r"\D", "", prefix or "") or "60"), digits


def contact_name(account_field: str, fallback: str) -> str:
    """The account name off page 1's Account field ("NAME[7043685929]"), else
    the customer name. Page 1 creates the account AFTER this step, with the
    customer name, so on page 1 the fallback is the same name."""
    name = re.sub(r"\s*\[[^\]]*\]\s*$", "", account_field or "").strip()
    return name or (fallback or "").strip()


def classify(label: str) -> str | None:
    """Which order value a New Contact label wants, or None (left alone)."""
    lab = re.sub(r"[*:]", "", label or "").strip().lower()
    if "second" in lab or "2nd" in lab:
        return None  # Second Customer Mobile stays blank.
    if "mobile" in lab:
        return "mobile"
    if "email" in lab:
        return "email"
    if "name" in lab:
        return "name"
    return None


def plan_fill(rows: list, values: dict) -> dict:
    """{control id: value} for the scanned rows. A mobile row with two boxes is
    country code + number; with one box, the full number."""
    out = {}
    for row in rows or []:
        kind = classify(row.get("label", ""))
        ctrls = row.get("controls") or []
        if not kind or not ctrls:
            continue
        if kind == "mobile":
            if len(ctrls) >= 2:
                out[ctrls[0]["id"]] = values["area"]
                out[ctrls[1]["id"]] = values["phone"]
            else:
                out[ctrls[0]["id"]] = values["area"] + values["phone"]
        else:
            out[ctrls[0]["id"]] = values[kind]
    return out
