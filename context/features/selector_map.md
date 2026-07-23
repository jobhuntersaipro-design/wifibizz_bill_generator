# Unifi eSales — Order Entry Selector Map

Verified by live DOM inspection on the Order Entry CRM
(`dealer.unifi.com.my/esales/crm-TYMH100163`). This is the ground truth for
building `order_entry.py`. Update it whenever a new screen is captured.

---

## 0. Framework & global facts

- **Two layers:**
  - **Outer page** = React + Ant Design (the shell, header, left nav). Selectors like `.ant-menu-item`.
  - **Inner app** = jQuery UI + Bootstrap 3, inside `iframe#myIframe`
    (`src="FishModule/remote.html?crm/modules/pos/orderentry/views/CCEntryView"`).
    All order-flow work happens here.
- **Left-nav items carry `privcode`** (stable navigation hooks):
  - Order Entry = `crm-TYMH100163`
  - Retail Order = `retailHistoryView`
  - Order Entry (Business Portal) = `crm-TYMH100152`
  - Device Eligibility Check = `deviceUpfrontCheck`
  - Selector: `li.ant-menu-item[privcode="crm-TYMH100163"]`
- **The order app lives inside an iframe.** Stable id `#myIframe`
  (the class suffix `myIframe___xxxx` is random — never anchor on it).
  - Playwright: `frame = page.frame_locator("#myIframe")` then everything via `frame`.
- **`.click()` works** on this app (programmatic clicks fire handlers).
  No need for coordinate-based mouse events.
- **Modals/dialogs** render as `.ui-dialog` siblings of `#app` inside the
  iframe body (NOT nested in the page they belong to). Newest dialog =
  `last` of `.ui-dialog`.
- **`js-*` classes are the intended hooks** and appear stable. Prefer them.
- Expect noisy console errors (`trackSensors is not defined`, `埋点报错`) —
  that's the neutered anti-bot telemetry. Harmless; ignore.

---

## 1. The combobox pattern (MOST IMPORTANT — reused everywhere)

Every dropdown is a paired structure:

```
<div .input-group.ui-combobox-fish>
  <input role="combobox" placeholder="---Please select---">   <- visible display
  <span .input-group-addon>
    <span .glyphicon.glyphicon-triangle-bottom>                <- trigger
<input name="<fieldName>" class="ui-combobox-disabled">        <- HIDDEN real value
```

When opened, the option list appears (elsewhere in the DOM):

```
<ul .dropdown-list.combobox-dropdown role="listbox">
  <li role="option" title="MyKad"> "MyKad"
  <li role="option" title="Passport"> "Passport"
  ...
```

**To set a combobox** (pseudocode for the reusable helper):
1. Click the display input (the `role="combobox"` input inside the field's `.form-group`).
2. Wait for `ul.combobox-dropdown` to be visible.
3. Click `ul.combobox-dropdown li[title="<value>"]`.
4. (Do NOT try to `.fill()` the hidden `name=...` input — app needs the click.)

Anchor each combobox by the **hidden input's `name`**, walk up to its
`.form-group`, then click the sibling display input. Or anchor by the
label `title` text.

---

## 2. Customer-type picker (first modal)

| Action | Selector |
|---|---|
| Personal Customer | `.show-customer-left` (or `.personal-customer`) |
| Business Customer | `.show-customer-right` (or `.business-customer`) |
| Close | `.close` |

Note: targets are `<div>`, not `<button>`. Clicking `.show-customer-left`
(the whole card) is most reliable.

---

## 3. Personal Customer form

Dialog title: `.js-cur-modal-title` = "Personal Customer".

### Read Card panel
| Field | Selector | Notes |
|---|---|---|
| ID Type (combobox) | hidden `input[name="certTypeId"]` (`.js-certTypeId`) | options: I-KAD, MyKAS, MyKad, MyPR, MyTentera, Passport |
| Read Card btn | `.js-read-card` | for physical card readers — skip in automation |
| Customer Check btn | `.js-check` | |

### Basic Information (`form.js-cust-form`)
| Field | Selector (anchor) | Type | Required |
|---|---|---|---|
| Customer Name | `input[name="custName"]` | text | ✓ |
| ID Number | `input[name="certNbr"]` | text | ✓ |
| Title | `input[name="custTitleId"]` | combobox | |
| ID Expiry Date | `input[name="expDate"]` | date `dd-mm-yyyy` | |
| Gender | `input[name="gender"]` | combobox | ✓ |
| Marital state | `input[name="name_100465"]` | combobox | |
| Birthday | `input[name="birthdayDay"]` | date `dd-mm-yyyy` | ✓ |
| Race | `input[name="name_400011"]` | combobox | ✓ |
| Nationality | `input[name="name_400020"]` | combobox | ✓ |
| Religion | `input[name="religionId"]` | combobox | |
| Preferred Language | `input[name="custDefLangId"]` | combobox | ✓ |
| Customer Group | `select[name="groupId"]` (`.js-group`) | select | |
| Residence Address | `input[name="address"]` (`.js-address`) | pop-edit (opens address modal via `.glyphicon-new-window`) | ✓ |
| Customer Remarks | `input[name="comments"]` | text | |
| Customer Type | `select[name="custType"]` | select: `A`=Individual, `C`=Corporate | ✓ |
| Company Name | `input[name="company"]` (`.js-company`) | text | |
| Country of Origin | `input[name="name_400012"]` | combobox | |

### Customer attributes (`.js-cust-attr-form`) — coded names, stable
| Field | Selector | Required | From manual (Residential) |
|---|---|---|---|
| Customer Tenure | `input[name="name_400054"]` | ✓ | |
| Sub-Segment | `input[name="name_410013"]` | ✓ | "Residential" |
| Segment | `input[name="name_410011"]` | ✓ | |
| Segment Code | `input[name="name_410008"]` | ✓ | "R10" (R10–R70) |
| Importance Tag | `input[name="name_410015"]` | | |
| (many more, several `.hide`) | `name_4000xx` / `name_4100xx` | | |

Fields with class `.hide` on their `.form-group` are not shown for this
ID type — skip unless they un-hide.

### Attachment
| Action | Selector |
|---|---|
| Doc type select | `select.js-select-doc-type` (value `2` = "Customer ID copy") |
| Add button | `.js-add-doc-type` ("+ Add") |
| (file input appears after Add — capture when building) | TBD |

### Contact Information (`form.js-qry-form`, tab `#tabs-a`)
| Field | Selector | Type | Required |
|---|---|---|---|
| Name | `input[name="contactManName"]` (`.js-custName`) | text | ✓ |
| Preferred Contact | `input[name="mainComm"]` | combobox | ✓ |
| Role | `input[name="roleType"]` | combobox | ✓ |
| Contact Man Type | `input[name="contactManType"]` | combobox | ✓ |
| ID Type | `input[name="certTypeId"]` (`.contactCertTypeId`) | combobox | |
| ID Number | `input[name="certNbr"]` (within contact form) | text | |
| Mobile No.1 prefix | `input[name="mobileAreaCode"]` (`.js-mobileAreaCode`, "eg.60") | text | ✓ |
| Mobile No.1 number | `input[name="mobilePhone"]` (`.js-mobilePhone`) | text | ✓ |
| Mobile No.2 prefix | `input[name="homeAreaCode"]` (`.js-homeAreaCode`) | text | |
| Mobile No.2 number | `input[name="homePhone"]` (`.js-homePhone`) | text | |
| Email | `input[name="emailAddr"]` | text | ✓ |
| Customer Address | `input[name="address"]` (`.js-tab-address0`) | text | |
| Check button | `#check-button` (`.js-check-btn`) | | |
| Add contact tab | `.js-add-contact` | | |

> NOTE: contact form reuses `name="certTypeId"`/`name="certNbr"` which also
> exist in Read Card. Always scope contact lookups within `form.js-qry-form`
> or `#tabs-a` to avoid collisions.

### Form footer
| Action | Selector |
|---|---|
| OK (submit profile) | `.js-ok` |
| Cancel | `.js-cancel` |

---

## 4. Feasibility Check screen

Reached from Order Entry shopping bar:

| Action | Selector |
|---|---|
| Feasibility Check btn | `.js-anonymous-add-survey` |
| New Connection / Go Shop | `.js-go-shopping` (`#intro-go-shopping`) |
| Shopping cart | `.js-go-shopping-cart` (count: `.js-item-cnt`) |
| Redemption Order | `.js-redemption-order-btn` |

Panel (`form.js-query-form`), title `.js-address-survey-title` = "Feasibility Check":

| Element | Selector | Notes |
|---|---|---|
| Address pop (required) | `.js-address-pop` | opens Select Address modal |
| Main Offer area | `.js-shrink-body` | |
| Inbound area | `.js-inbount` | |
| Customer area | `.js-customer` | |
| Subscription Plan List grid | `.js-offer-grid` (jqGrid, random id suffix) | plan results table |
| Plan search input | `.search-group input.form-control` (above grid) | |
| Order btn | `.js-orderNow` | proceeds to order |
| Create Demand Case | `.js-createDemandCase` | |
| Cancel | `.js-cancel` | |
| Close (back arrow) | `.js-close` | |

> Form groups inside `js-query-form` render empty until populated — re-capture
> with a selected address to see address display + Main Offer pencil.

---

## 4b. Select Address modal

Title `.modal-title` = "Select Address". Form `form.js-address-form`.

| Element | Selector | Notes |
|---|---|---|
| Customer Type (combobox, req) | `input[name="custType"]` | |
| Search Type: By keyword | `#byKeywords` | active tab has `.curr` |
| Search Type: By Street | `#byStreetName` | |
| Search Type: By Building | `#byBuildName` | |
| Search Type: By Address Id | `#byAddressId` | |
| State (combobox, req) | `input[name="state"]` | |
| Keywords (req for By keyword) | `input[name="keywords"]` (`.js-keywords`) | |
| Street Name | `input[name="streetName"]` (in `.js-search-StreetName-div`) | |
| Building Name | `input[name="buildName"]` (in `.js-search-buildName-div`) | |
| Address Id | `input[name="addressId"]` (in `.js-search-addressId-div`) | |
| Street Type (combobox) | `input[name="streetType"]` | |
| Query btn | `.js-query` | |
| Results grid | `.js-address-grid` (jqGrid) | rows: `#btable_<id> tr[role="row"]` (click to select) |
| **Empty / not-found signal** | `.ui-jqgrid-tip` text = "No record to view" | -> report address-not-found |
| Address Service Category column | grid col `*_addrServiceCategory` | indicates existing service (MSR risk) |
| Page size select | `select.ui-pagination` (5/20/50) | |
| OK (confirm selection) | `.js-ok` | |

> EDGE CASES surfaced here:
> - "No record to view" in `.ui-jqgrid-tip` = address not found (slide 19) -> BizzFlow error.
> - Address already has TM service -> Warning modal on Query/Next (slide 56) -> BizzFlow error.

---

## 4c. Main Offer Selector modal

Title `#js-offer-title` = "Main Offer Selector". Opened via the `.glyphicon-new-window`
pencil inside `.js-shrink-body` on the Feasibility panel (only appears after an
address is selected).

| Element | Selector | Notes |
|---|---|---|
| Category search | `input.js-offer-catg-search` (name="search") | |
| All Category checkbox | `input.js-all-catg` | tick to search across all (slide 22) |
| Category tree | `.js-offerCatg-tree` | zTree |
| A category node | `.js-offerCatg-tree a.level0[title="unifi Home Bundle Sale Catg"]` | anchor by title |
| Plan results grid | `.js-offer-grid` (jqGrid, random id) | |
| Plan filter toggle | `.js-filter` (Main Offer / Main Product) | |
| Plan search input | grid titlebar `input.form-control` | |
| A plan row | `tr.jqgrow[id="<offerId>"]` or `tr.jqgrow:has(td[title="<Plan Name>"])` | row id = offer id; click row to select |
| Submit (OK) | `.js-btn-submit` | |
| Cancel | `.js-btn-cancel` | |

Target plan from manual: "Unifi Home 300Mbps Netflix" under category
"unifi Home Bundle Sale Catg".

---

## REUSABLE HELPERS (the whole automation rests on these 3)

1. **Frame** — everything goes through `page.frame_locator("#myIframe")`.

2. **setCombobox(fieldName, optionText)** — for every `---Please select---` dropdown:
   - find `.form-group` containing hidden `input[name="<fieldName>"]`
   - click its display input (`input[role="combobox"]`)
   - wait for `ul.combobox-dropdown` visible
   - click `ul.combobox-dropdown li[title="<optionText>"]`

3. **selectGridRow(gridSelector, matchText)** — for every jqGrid (address, offers, VoBB, etc.):
   - within `gridSelector` find `tr.jqgrow:has(td[title="<matchText>"])` (or by row id)
   - click the row (or its `.cbox` checkbox)
   - handle "No record to view" via `.ui-jqgrid-tip` -> not-found error

Plus **waitDialog(titleText)** and **closeDialog()** helpers, since dialogs are
`.ui-dialog` siblings; newest = last.

---

## 6. Error / MSR dialog pattern (CRITICAL for BizzFlow reporting)

All errors render as a jQuery UI dialog **inside `#myIframe`** (not the outer layer):

```
<div .ui-dialog.modal-danger>          <- modal-danger = error signal
  <div .modal-header>
    <h4 .modal-title> "Error"
  <div .modal-body>
    <div .modal-message> "<the error text>"
  <div .modal-footer>
    <button .btn-danger> "OK"
```

| Element | Selector |
|---|---|
| Error dialog | `.ui-dialog.modal-danger` |
| Message text | `.modal-danger .modal-message` |
| Dismiss | `.modal-danger .modal-footer .btn-danger` |

Known messages -> error codes for BizzFlow:
- "This address already has TM services installed..." -> `address_already_has_service` (MSR, slide 56)
- (capture others as they occur: Customer ID max-line slide 57, business offline-approve slide 55)

Detection strategy: after every Query/Next/OK/Pay action, check for
`.ui-dialog.modal-danger`. If present, read `.modal-message`, map to a code,
return `{status:"error", error:<code>, message:<text>}`, dismiss, stop.

Success dialogs use the green/success variant (`.modal-success` or similar) with
`.modal-message` "...successfully..." — capture exact class during dry-run.

---

## 7. Still to capture (back half — let the dry-run dump-helper grab these)
- [x] Main Offer Selector modal — done (section 4c)
- [x] Select Address modal — done (section 4b)
- [x] Mobile field selectors — done
- [ ] Address pop-edit modal opened from the **customer form's** Residence Address (may differ from feasibility address modal)
- [ ] File input that appears after attachment "+ Add"
- [ ] Order detail screen: Install Info, Bundle/Broadband/Voice tabs
- [ ] Billing account creation modal (slides 28-30): Add Account form fields
- [ ] Broadband login ID field + Check button (slide 31, 2-11 chars)
- [ ] VoBB number picker (slides 33-35): the "Select Number" modal + number tiles
- [ ] Appointment calendar (slide 41-42)
- [ ] Contactless Flag dropdown (slide 38) + "Has confirmed order" checkbox (slide 44) + Pay (slide 46)
- [ ] Success state: where Customer Order Number is shown (slide 48)
- [ ] MSR / Exception / Warning modal text (slides 55-57) for error reporting
