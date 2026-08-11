"""
oe_dump.py - Dev-only helper for capturing the order app's back-half screens.

Stages 6-13 (install info, billing account, broadband login, VoBB picker,
appointment, contactless/confirm, success) are not yet mapped in
SELECTOR_MAP.md. During the first guided dry-run, call
`dump_iframe_dialog(page, "install_info")` etc. at each new screen, then use
the dumps to fill in selectors. Same structural-dump JS used to map stages 1-5.

Not imported by the production flow — only by inspection scripts and tests.
"""

import os

DUMP_DIR = "logs"

# Walks the newest visible `.ui-dialog` inside #myIframe (or the iframe body if
# no dialog is open), emitting an indented structural outline. Captures only the
# attributes that matter for building selectors.
_DUMP_JS = r"""(() => {
  const frameEl = document.querySelector('#myIframe');
  if (!frameEl || !frameEl.contentDocument) return 'iframe #myIframe not found';
  const d = frameEl.contentDocument;
  const dl = [...d.querySelectorAll('.ui-dialog')].filter(x => x.offsetParent !== null);
  const root = dl[dl.length - 1] || d.body;
  const lines = [];
  const walk = (el, dep) => {
    if (dep > 16) return;
    const t = el.tagName.toLowerCase();
    if (t === 'script' || t === 'style') return;
    const cls = (el.className || '').toString().trim();
    const id = el.id ? '#' + el.id : '';
    const tx = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
    const a = [];
    for (const x of el.attributes || []) {
      if (['placeholder', 'type', 'role', 'title', 'value', 'name', 'for'].includes(x.name)) {
        a.push(x.name + '="' + x.value + '"');
      }
    }
    lines.push(
      '  '.repeat(dep) + '<' + t + id +
      (cls ? ' .' + cls.split(/\s+/).join('.') : '') +
      (a.length ? ' ' + a.join(' ') : '') + '>' +
      (tx ? ' "' + tx + '"' : '')
    );
    for (const c of el.children) walk(c, dep + 1);
  };
  walk(root, 0);
  return lines.join('\n');
})()"""


async def dump_iframe_dialog(page, label: str) -> str:
    """
    Dump the newest `.ui-dialog` (or iframe body) structure inside #myIframe to
    `logs/dump_<label>.txt`, plus a full-page screenshot at `logs/dump_<label>.png`.

    Returns the path to the text dump.
    """
    os.makedirs(DUMP_DIR, exist_ok=True)
    outline = await page.evaluate(_DUMP_JS)

    txt_path = os.path.join(DUMP_DIR, f"dump_{label}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(outline)

    try:
        await page.screenshot(path=os.path.join(DUMP_DIR, f"dump_{label}.png"), full_page=True)
    except Exception as e:
        print(f"  [dump] screenshot failed: {e}")

    print(f"  [dump] iframe outline -> {txt_path}")
    return txt_path
