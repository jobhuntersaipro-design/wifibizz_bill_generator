# Decision trail: install == delivery address

## Task
ClickUp z8v9xnfn8e. Keep installation and delivery addresses 100% identical.

## Playbook
Bug fix.

## Root cause (code + mechanism)
`scraper/oe_feasibility.py` `delivery_terms` ticked `input[name=defaultBillingAddress]` and OKed the Enter Address dialog without editing it. That dialog is pre-filled from the **billing account** address.

Billing differs from installation when:
1. An existing billing account is selected (it keeps the address it was opened with), or
2. The portal seeds a new account's billing address from a customer residence that differs from the selected serviceable installation unit.

BizzFlow Order Entry stores one address (`street`). The divergence is minted on the Unifi portal at `delivery_terms`, then shows in Case/Provisioning views that read portal fields.

When the box was already ticked the old block did nothing and left the billing address in place. Reproduced on the fixture page in `scraper/tests/test_delivery_address.py`: the old block reports `billing_addr: ok` while the page's delivery fields hold the billing address, in both the unticked and the already-ticked shape.

## Fix
`scraper/delivery_address.py` owns the invariant.
- `installation_address_for_delivery(payload)` is pure. Street comes from `address.address_full`, then `address.keywords` (ignored when it is a bare postcode, which is what `order_to_payload` falls back to), then the residence fields, collapsed through `order_entry.normalize_address_line` because the portal validator refuses consecutive whitespace.
- `set_delivery_address(frame, page, payload)` unticks and re-ticks the box so the dialog always opens, types the postcode and tabs out (the gesture that makes the portal fill City/State, per `fill_residence_address`), fills the street, fills City/State only when the portal leaves them editable, clicks OK, and treats a dialog that stays open as `delivery_address_rejected` with the flagged labels named.
- Empty installation street, missing checkbox, dialog not opening, or a field that cannot be written all return an error. The step never OKs the billing address.
- `fill_customer_order_info` calls the step and records `steps["delivery_addr"] = "ok (from installation: street, postcode)"`. The `billing_addr` step key is gone; nothing read it.

## Choices
- Playwright gestures over `page.evaluate` value-setting, because the residence pop-edit proved live that typing the postcode plus Tab drives the City/State auto-fill. Disabled portal fields are left to the portal rather than force-enabled.
- One label-text fallback per field, no more. The residence modal selectors are the evidence; a differing delivery dialog fails with the field named.

## Migration choice
On-touch only. Already-submitted portal orders keep their current fields until an agent corrects them in the portal or resubmits through the fixed path. No one-time portal rewrite shipped.

## Verification
- `cd scraper && python -m pytest tests/test_delivery_address.py -q`: 11 passed (5 pure, 6 in headless Chromium against the fixture page).
- Old-vs-new replay on the same fixture (script kept out of the repo): old block leaves `BLOK 11 LORONG BUKIT SEPANGGAR 1 / 88450`, new step leaves `353 LORONG MERPATI 4 TAMAN MERPATI / 90000` with City/State auto-filled to SANDAKAN / SABAH.
- Not verified against the live dealer portal from this environment (no dealer session available). The delivery dialog's selectors are inferred from the residence pop-edit widget of the same name.

## Principles cited
- principle-fix-root-causes: fix at the point that mints the divergence, reproduce first.
- principle-model-the-domain: one module owns delivery := installation.
- principle-laziness-protocol: reuse `normalize_address_line`, one step key, one fallback per field.
- principle-test-behavior-not-implementation: browser tests assert literal page values, not the JS string.
- principle-prove-it-works: red then green, plus the old-vs-new replay.
