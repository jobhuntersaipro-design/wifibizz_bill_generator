# Decision trail — install === delivery address

## Task
ClickUp z8v9xnfn8e — Keep installation and delivery addresses 100% identical.

## Playbook
Bug fix.

## Root cause (code + mechanism)
`scraper/oe_feasibility.py` `delivery_terms` (~4473) checks `input[name=defaultBillingAddress]` and OKs the Enter Address dialog without editing fields. That dialog is pre-filled from the **billing account** address.

Billing ≠ installation when:
1. An existing billing account is selected (account still carries an older address), or
2. The portal prefills a new account's billing address from customer residence that differs from the selected serviceable installation unit.

BizzFlow Order Entry stores one address (`street`). Divergence is minted on the Unifi portal at delivery_terms, then visible in Case/Provisioning views that read portal fields.

If the checkbox is already checked, the current code skips the block entirely and leaves whatever delivery address is already set.

## Fix direction
Delivery address is always overwritten from the order's installation address before the Enter Address dialog is OKed. Billing is only used to open the dialog. Empty installation street fails the step instead of falling through to billing.

## Migration choice
On-touch only. Already-submitted portal orders keep their current fields until an agent corrects them in the portal or resubmits through the fixed path. No one-time portal rewrite shipped.

## Principles cited
- principle-fix-root-causes: fix delivery_terms source, not a UI band-aid
- principle-model-the-domain: delivery := installation (one premise address)
- principle-laziness-protocol: smallest change at the diverge point
- principle-prove-it-works: unit tests on the helper + live verify when possible
