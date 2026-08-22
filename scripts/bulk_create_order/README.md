# Bulk-create draft orders

Creates **draft** orders in BizzFlow from a hand-written file of customers, with
the same document (`ic_upload.png`) attached to every one. Nothing is submitted —
each row lands in the Orders table as a `draft` for a human to submit, because
every successful submit mints a real, chargeable Unifi order.

Files here:

| File | What it is |
| --- | --- |
| `bulk-create-orders.ts` | the script |
| `orders.json` | the four test customers, editable |
| `ic_upload.png` | the file uploaded as every document |

## Run it

```bash
# preview — validates every row, uploads nothing, writes nothing
npx tsx scripts/bulk_create_order/bulk-create-orders.ts --user <bizzflow-email> --dry-run

# for real
npx tsx scripts/bulk_create_order/bulk-create-orders.ts --user <bizzflow-email>
```

`--user` is the BizzFlow login email the drafts belong to (the account whose
Orders table they show up in), not the dealer staff code.

| Flag | Default | Effect |
| --- | --- | --- |
| `--user <email>` | required | whose drafts these are |
| `--file <path>` | `./orders.json` | the customer list |
| `--doc <path>` | `./ic_upload.png` | the file uploaded per document type |
| `--limit N` | all | stop after N rows written |
| `--dry-run` | off | validate and print only — no R2 upload, no DB write |
| `--no-docs` | off | write the drafts with no documents at all |
| `--force` | off | write even when an order with the same ID number exists |

Needs `DATABASE_URL` and the `R2_*` variables in `.env` (the same ones the app
uses). With `--no-docs` only `DATABASE_URL` matters.

## The customer file

```jsonc
{
  "defaults": {            // merged into every row; a row can override any key
    "idType": "MyKad",
    "mobilePrefix": "60",
    "offerName": "Unifi Home 500Mbps Premium Value With Device (36M)",
    "docTypes": ["im_conversation", "mykad"],
    "remarks": "TEST DRAFT — bulk-created test data, not a real customer."
  },
  "orders": [
    {
      "label": "Testing Order 1",     // for the run log only
      "idNumber": "920505034434",
      "fullName": "Phong Kone Lee",
      "mobile": "148893212",          // no leading 0, no country code
      "email": "jjllac213@gmail.com",
      "offerName": "…",               // optional — falls back to defaults
      "deviceCode": "431384",         // optional — see "The device" below
      "deviceName": "…",
      "street": "C-30-11 JALAN ECO MAJESTIC … SELANGOR MALAYSIA 43500"
    }
  ]
}
```

`docTypes` accepts `im_conversation`, `mykad`, `passport`, `id`, `utility_bill`,
`other` — one upload of `--doc` per entry, keyed exactly the way the order form
keys its own uploads (`orders/<userId>/<idNumber>_<slug>_1.png`), so a draft
written here is indistinguishable from one an agent filled in by hand.

**Gender and birthday are never in the file.** They are derived from the MyKad
with the app's own parser, because the portal sees what the ID encodes — a
hand-typed value that disagreed would be a row saying one thing and a submit
doing another. Postcode, city and state are likewise derived from the address.

## What it checks before writing a row

A row that fails any of these is skipped and named in the summary; the rest of
the run continues.

- The address passes `validateMalaysianAddress` — the same check `saveOrder`
  applies, so a row that fails it could never be re-saved from the order form.
- The ID parses as the given ID type, the name is present, the email is
  well-formed.
- No order for that ID number already exists on the account. Re-running after a
  half-finished run tops the set up rather than doubling it, and a duplicate ID
  sends a submit down the multiple-customer path instead of the one being
  tested. `--force` overrides.

## The device

An offer whose name contains "With Device" needs one, and if the row does not
name a device the script takes the **cheapest** entry in the device catalog
(currently an iPad at RM1) — cheapest because these drafts are not meant to be
paid for. The portal filters its device list per package, so that pick is not
guaranteed to be on offer for the package in the row; if a submit comes back
`device_out_of_stock` or the device tab refuses it, set `deviceCode` and
`deviceName` on the row from what the portal actually lists.

## Not verified

The address is written exactly as given and **is not checked against the
portal** — whether Unifi sells at it is decided by the submit. If you want
addresses the portal has confirmed first, that is what
[`scripts/seed-orders.ts`](../seed-orders.ts) does (it invents the customers,
though; this script exists for when the customer data is the given part).

The run above was exercised with `--dry-run` against the real database; a live
write and the R2 uploads have not been run.
