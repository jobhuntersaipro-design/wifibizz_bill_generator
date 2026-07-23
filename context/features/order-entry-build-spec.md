# Build Spec — `order_entry.py` (Unifi eSales Order Entry automation)

> **For Claude Code.** This is the implementation brief for adding automated
> order entry to an existing Playwright project that already scrapes the Unifi
> dealer portal. Read `SELECTOR_MAP.md` (companion file) for the verified DOM
> selectors. This file explains *what to build and how it must behave*.

---

## 1. Goal

My partner currently keys new Unifi broadband orders by hand at
`https://dealer.unifi.com.my/esales/crm-TYMH100163` (the eSales "Order Entry"
CRM). It's slow. I want to drive it programmatically from the backend, then
surface only the result in BizzFlow: an **order id** on success, or a clear
**error** on failure.

The single public entrypoint:

```python
async def enter_order(payload: dict, dry_run: bool = True) -> dict:
    """
    Returns one of:
      {"status": "success", "order_id": "2503000062852562"}
      {"status": "error", "error": "address_already_has_service",
       "message": "...", "screenshot": "logs/err_...png", "stage": "feasibility"}
      {"status": "dry_run", "would_submit": {...}, "screenshot": "..."}
    Never raises for *expected* flow failures (MSR, address-taken, validation) —
    those are returned as status=error. Only raises on infrastructure failures
    (browser launch, lost session) so the caller can retry.
    """
```

**`dry_run=True` MUST be the default.** This flow submits real, billable orders.
Dry-run walks every step, fills every field, stops *before* the final Pay /
Submit, captures a screenshot + the computed fee preview, and returns what it
*would* submit. Only `dry_run=False` clicks Pay/Submit.

---

## 2. Reuse what already exists — DO NOT reinvent

The project already has these working modules. Use them as-is:

- **`login_manager.py`** — `login_and_get_context(username, password)` returns
  `(browser, context, pw, page)`. Handles stealth, the `fishx*.js` anti-devtool
  patching, session cache, and OTP login via Gmail. **The order flow's auth is
  already solved by this.** Do not write new login logic.
- **`credential_manager.py`** — `CredentialManager().get_credentials()` ->
  `{"username","password"}` (Fernet-encrypted at `config/`). **Today** the flow
  runs against the `TMRS00517` dealer account from stored credentials; see
  section 11 for the planned shift to UI-driven session capture.
- **`inspect_order_entry.py`** — the headed inspector + `dump_html()` /
  `list_form_fields()` helpers used to map the UI. Reuse its `dump_html` and the
  structural-dump JS for capturing the back-half screens (section 7).

**Run from project root** so `config/` and `sessions/` resolve.

---

## 3. The single most important structural fact

The entire order app runs **inside an iframe**: `iframe#myIframe`
(`src=".../CCEntryView"`). The outer page is React/Ant; the inner app is
jQuery UI + Bootstrap 3.

**Every order-flow locator must go through the frame:**

```python
frame = page.frame_locator("#myIframe")
await frame.locator(".js-anonymous-add-survey").click()   # etc.
```

The iframe's class suffix is random (`myIframe___xxxx`) — **anchor on the id
`#myIframe`**, never the class. Dialogs render as `.ui-dialog` *siblings* inside
the iframe body; the newest open one is the last `.ui-dialog`.

Navigation (left menu) is on the **outer** page: `li.ant-menu-item[privcode="crm-TYMH100163"]`.

---

## 4. The 3 reusable helpers everything depends on

Build these first and test them in isolation — ~80% of the flow is these three.

### 4.1 `set_combobox(frame, field_name, option_text)`
Every dropdown (`---Please select---`) is a paired widget: a visible
`input[role="combobox"]` + a hidden `input[name="<field_name>"]`. You cannot
`.fill()` the hidden input — the app needs the click sequence:

1. Locate the `.form-group` (or `.input-group.ui-combobox-fish`) that contains
   the hidden `input[name="<field_name>"]`.
2. Click the visible display input (`input[role="combobox"]`) inside it.
3. Wait for `ul.combobox-dropdown` (role="listbox") to be visible.
4. Click `ul.combobox-dropdown li[title="<option_text>"]`.
5. Assert the hidden input now has a value (sanity check).

Verified options example (ID Type): I-KAD, MyKAS, MyKad, MyPR, MyTentera, Passport.

### 4.2 `select_grid_row(frame, grid_selector, match_text=None, row_id=None)`
Every results table is a jqGrid. Rows live in `#btable_<id> tr.jqgrow`, each
`<td title="...">`. To select:

- by text: `{grid} tr.jqgrow:has(td[title="<match_text>"])` then `.click()`
- by id: `{grid} tr.jqgrow#<row_id>` (row id == the entity id, e.g. offer id)
- Before selecting, check empty state: `.ui-jqgrid-tip` containing
  "No record to view" -> raise/return a not-found signal.

### 4.3 `check_error(frame)` — call after EVERY Query/Next/OK/Pay
Errors are jQuery UI dialogs: `.ui-dialog.modal-danger` with `.modal-message`.

```
if frame.locator(".ui-dialog.modal-danger").is_visible():
    msg = frame.locator(".modal-danger .modal-message").inner_text()
    code = map_error(msg)            # see section 6
    frame.locator(".modal-danger .modal-footer .btn-danger").click()  # dismiss
    return {"status":"error","error":code,"message":msg,"stage":<current>}
```

Supporting helpers: `wait_dialog(frame, title_text)`, `close_dialog(frame)`,
`newest_dialog(frame)` = `.ui-dialog >> nth=-1`.

---

## 5. The flow (stages) — map to `SELECTOR_MAP.md`

Implement as discrete, individually-testable stage functions. Each returns a
result dict; the orchestrator stops at the first non-OK result.

```
enter_order(payload, dry_run)
 ├─ 0. ensure_on_order_entry(page)          # outer nav: privcode=crm-TYMH100163
 ├─ 1. create_personal_customer(frame, payload.customer)   # MAPPED ✓
 ├─ 2. open_feasibility(frame)               # .js-anonymous-add-survey  MAPPED ✓
 ├─ 3. select_address(frame, payload.address)# Select Address modal      MAPPED ✓
 │       └─ check_error -> address_already_has_service / not_found
 ├─ 4. select_main_offer(frame, payload.plan)# Main Offer Selector        MAPPED ✓
 ├─ 5. click_order(frame)                     # .js-orderNow
 ├─ 6. fill_install_info(frame, payload)      # TODO capture (slide 25-26)
 ├─ 7. create_billing_account(frame, payload) # TODO capture (slide 28-30)
 ├─ 8. set_broadband_login(frame, payload)    # TODO (slide 31, 2-11 chars)
 ├─ 9. pick_vobb_number(frame)                # TODO (slide 33-35)
 ├─ 10. set_appointment(frame, payload)       # TODO (slide 41-42)
 ├─ 11. set_contactless_and_confirm(frame)    # TODO (slide 38, 44) Contactless=YES
 ├─ 12. [dry_run? STOP+screenshot+fees] else pay_and_submit(frame)  # slide 46
 └─ 13. capture_order_id(frame)               # slide 48 "Order Number: ..."
```

Stages 1–5 are fully mapped in `SELECTOR_MAP.md`. Stages 6–13 need DOM capture —
do that with the dump helper (section 7) during the first dry-run, then fill in
selectors. Build 1–5 solid first; they prove the mechanics.

### Stage 1 field map (customer creation) — from SELECTOR_MAP §3
Required: custName, certNbr, certTypeId(combobox), gender(combobox),
birthdayDay(date dd-mm-yyyy), Race(name_400011), Nationality(name_400020),
Preferred Language(custDefLangId), Residence Address(name=address, pop-edit),
Customer Type(select custType=A), Customer Tenure(name_400054),
Sub-Segment(name_410013), Segment(name_410011), Segment Code(name_410008).
Contact tab (scope to `form.js-qry-form`): contactManName, mainComm(combobox),
roleType(combobox), contactManType(combobox), mobileAreaCode+mobilePhone,
emailAddr. Attachment: `select.js-select-doc-type` (value 2 = Customer ID copy)
+ `.js-add-doc-type`. Submit: `.js-ok`.

> ⚠️ `certTypeId`/`certNbr` exist in BOTH Read Card and Contact forms — always
> scope contact-form lookups within `form.js-qry-form` to avoid collisions.

---

## 6. Edge cases (must be handled, not crashed on)

These come straight from the partner training PDF. Each maps to a returned
error code:

| Situation | Where | Error code |
|---|---|---|
| Address already has TM service | feasibility query | `address_already_has_service` |
| Address not found | address grid empty | `address_not_found` |
| MSR — Customer ID max line | after order/next | `msr_customer_id_limit` |
| MSR — business offline approve popup | business orders | `msr_offline_approval` |
| Login ID invalid (not 2–11 chars) or taken | broadband Check | `login_id_invalid` / `login_id_taken` |
| VoBB number pool empty | number picker | `vobb_unavailable` |
| Advance Payment / Deposit required | fee preview branch | not an error — record AP/deposit amount in result |
| Duplicate billing account | billing step | create NEW account each order (per manual note #3) |
| "Has confirmed order with customer" checkbox gates Next | confirm step | must tick before proceeding |

`map_error(msg)` matches on substrings of `.modal-message`. Log any unmapped
message verbatim and return `unknown_error` + the text so we can add it.

---

## 7. Capturing the remaining screens (stages 6–13)

Reuse the structural-dump JS (same one used to map stages 1–5). Add a helper to
`order_entry.py` for dev use:

```python
async def dump_iframe_dialog(page, label):
    """Dump newest .ui-dialog (or body) structure inside #myIframe to logs/."""
    js = r'''(() => {
      const d = document.querySelector('#myIframe').contentDocument;
      const dl = [...d.querySelectorAll('.ui-dialog')].filter(x=>x.offsetParent!==null);
      const root = dl[dl.length-1] || d.body;
      const lines=[]; const walk=(el,dep)=>{ if(dep>16)return;
        const t=el.tagName.toLowerCase(); if(t==='script'||t==='style')return;
        const cls=(el.className||'').toString().trim(); const id=el.id?'#'+el.id:'';
        const tx=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
        const a=[]; for(const x of el.attributes||[]) if(['placeholder','type','role','title','value','name','for'].includes(x.name)) a.push(x.name+'="'+x.value+'"');
        lines.push('  '.repeat(dep)+'<'+t+id+(cls?' .'+cls.split(/\s+/).join('.'):'')+(a.length?' '+a.join(' '):'')+'>'+(tx?' "'+tx+'"':''));
        for(const c of el.children) walk(c,dep+1); };
      walk(root,0); return lines.join('\n');
    })()'''
    html = await page.evaluate(js)
    open(f"logs/dump_{label}.txt","w").write(html)
    await page.screenshot(path=f"logs/dump_{label}.png", full_page=True)
```

During the first guided dry-run, call `dump_iframe_dialog(page, "install_info")`
etc. at each new screen, then hand the dumps back to fill in selectors. The
patterns will be the same three primitives (combobox / jqGrid row / dialog).

---

## 8. Payload shape (proposed — adjust to BizzFlow)

```python
payload = {
  "customer": {
    "id_type": "MyKad", "id_number": "901020141234", "name": "Testing ABC 01",
    "gender": "Female", "birthday": "20-10-1990", "race": "Malay",
    "nationality": "Malaysia", "preferred_language": "Bahasa Malaysia",
    "residence_address": "...", "segment_code": "R10",
    "sub_segment": "Residential",
    "contact": {"name":"Testing ABC 01","mobile_prefix":"60",
                "mobile":"1234567","email":"x@gmail.com",
                "role":"Owner","preferred_contact":"Yes"},
    "id_doc_path": "/path/to/id.png"
  },
  "address": {"search_type":"By keyword","state":"SELANGOR",
              "keywords":"DK01-08-15 ...","pick_row":0},
  "plan": {"category":"unifi Home Bundle Sale Catg",
           "name":"Unifi Home 300Mbps Netflix"},
  "login_id": "testabc01",           # 2-11 chars
  "appointment": {"strategy":"earliest"},  # or specific date
  "contactless": True
}
```

---

## 9. Operational notes

- **Headless vs headed:** `login_manager` launches headless by default; for the
  first dry-runs, force headed (see `inspect_order_entry.py`'s monkeypatch) so
  you can watch. Production can be headless.
- **Timing:** this app is slow and AJAX-heavy. After Query/Order/Next, wait for
  either the expected next element OR `.ui-dialog.modal-danger`, whichever comes
  first. Don't use blind `wait_for_timeout` as the primary sync.
- **Screenshots on every error and at dry-run stop** -> `logs/`. Surface the
  path in the result so BizzFlow can show it.
- **Idempotency:** per manual, create a NEW billing account each order. Don't
  reuse. Don't resubmit if an order_id was already returned.
- **Never bypass child/payment safety:** N/A here, but do not auto-tick consent
  checkboxes the partner is legally required to confirm beyond what the manual
  shows (the "Has confirmed order with customer" + auto Bypass Acknowledge are
  per the official flow, slides 44–45).
- **Console noise:** `trackSensors is not defined` / `埋点报错` are the neutered
  anti-bot telemetry. Expected. Ignore.

---

## 10. Suggested file layout

```
order_entry.py          # enter_order() orchestrator + stage fns
oe_helpers.py           # set_combobox, select_grid_row, check_error, wait_dialog
oe_errors.py            # map_error(), error code constants
oe_dump.py              # dump_iframe_dialog() dev helper
tests/
  test_helpers.py       # unit-test the 3 primitives against a live dry-run
  fixtures/payload_residential.json
```

Build order: `oe_helpers` -> stages 1–5 (dry-run, headed) -> capture 6–13 ->
finish stages -> error mapping -> flip dry_run default to False only after a
full successful dry-run review.

---

## 11. Future — UI-driven login & session capture (NOT yet built)

**Today (MVP):** auth runs against the single `TMRS00517` dealer account.
`credential_manager` stores its username/password (Fernet) and
`login_manager.login_and_get_context()` does username + password + Gmail-read OTP,
then caches cookies to `sessions/session_cache.json` (1-day expiry).

**Goal:** stop owning dealer passwords. Embed the dealer-portal login as a UI step
where the *user* supplies their own **username, password, and OTP** once; we
capture the resulting session and reuse it until it expires. This sidesteps
password rotation, per-dealer credential storage, and the Gmail-OTP coupling.

### Why this fits the current code
The durable layer already exists and does NOT need to change:

- `save_session(context)` / `load_session(context)` already persist and restore
  the Neon-portal cookies with an age check. This is the reusable core.
- The stealth init script + `fishx*.js` anti-devtool patching (section on
  `_patch_script`) are auth-independent — they apply to any session.

The only piece that gets swapped is **how the OTP is obtained**: today
`login_and_get_context()` calls `get_latest_otp()` (Gmail); the future flow takes
the OTP from user input instead.

### Sketch (to be specced properly when picked up)
1. BizzFlow surfaces a "Connect dealer account" screen (embedded or proxied
   portal login).
2. User enters username + password + the OTP they receive.
3. A headless/headed Playwright context performs the login with those values
   (reusing stealth + patching), then `save_session()` writes the cookies.
4. `enter_order()` and the scrapers consume the cached session via
   `load_session()`; on expiry, the user is re-prompted for a fresh OTP rather
   than us storing a password.

### Open questions for the future spec
- Per-user sessions vs the current single shared cache file (likely one cache
  per BizzFlow user → key the path by user id).
- Where the transient password/OTP live during the login round-trip (never
  persisted; in-memory only).
- Whether the portal can be embedded directly (iframe/CSP constraints) or must
  be proxied/automated behind the scenes.
- Session-expiry UX: detect the redirect-to-login and prompt for re-auth.

No code written yet. The active auth path remains `credential_manager` +
`login_and_get_context()` until this is scheduled.
