# Order Testing — SOP

How to get draft orders the Unifi portal will actually accept, and how to test a
submit against them without burning money you did not mean to spend.

**The one rule:** a successful submit mints a real, chargeable Unifi order. The
seeding steps below never submit. The submit step is manual, deliberate, and
ends with you voiding what you created.

---

## 0. Why this exists

Every draft on the account used to sit on the BSP 21 building, which the portal
answers with *"only offers services from other operators."* A submit against it
dies at the plan step, so it proves nothing about the rest of the flow.

An address existing in the portal's database is **not** the same as TM selling
there. `scripts/seed-orders.ts` only writes a draft for an address whose
Subscription Plan List the portal actually filled, and takes the draft's package
from that list rather than from our catalog.

---

## 1. Prerequisites

| Thing | Where | Check |
| --- | --- | --- |
| `DATABASE_URL` | `.env` | points at the branch you want the drafts on |
| `SCRAPER_API_URL` | `.env` | `http://localhost:5000` for local, the droplet URL for remote |
| `ORDER_ENTRY_API_TOKEN` | `.env` | must match the value the scraper service is running with |
| Dealer session | portal | connected, and not about to expire — see step 3 |

---

## 2. Start (or restart) the scraper service

The Flask service holds its imports from startup. A code change — including the
feasibility-probe route this SOP depends on — does **nothing** until it restarts.
A Next.js dev-server restart does not cover it.

**Local:**

```bash
pkill -f api_server.py
cd scraper && venv/bin/python api_server.py   # leave it running in its own terminal
```

Use `venv/bin/python`, not a bare `python3` — flask lives in the venv, and on a
plain shell `python3` may resolve to a system interpreter that dies immediately
with `ModuleNotFoundError: No module named 'flask'`.

Before killing it, check nothing is mid-run: `curl -s localhost:5000/health`
must report `"active_jobs":0`, or you are destroying someone's submit.

**Droplet:** `scraper/deploy.sh <tag>` rebuilds the container, which restarts it.

Confirm the new route exists before going further — a 404 here means you are
talking to the old process:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5000/dealer/feasibility-probe
# 401 = route is live and refusing an unauthenticated call. 404 = stale process.
```

---

## 3. Connect the dealer session

Open `/dashboard/order-entry` and connect. This is the only step that costs an
OTP cycle, so do it once and do the rest inside the session's lifetime.

Sessions last about an hour and the header shows the countdown. Each probe drives
a browser through several portal pages, so **budget roughly a minute per
address** and do not start a 30-address run with ten minutes left.

If the session dies mid-run the script stops rather than printing the same
failure once per remaining address.

---

## 4. Write the address file

One address per line; `#` comments and blank lines ignored.

```
# addresses.txt
NO 12, JALAN SS 15/4B, 47500 SUBANG JAYA, SELANGOR
NO 3, JALAN BESAR, 43300 SERI KEMBANGAN, SELANGOR
```

Each line must survive the app's own address validation — a single 5-digit
postcode, a recognisable state, and a street or unit token. The script checks
this before it calls the portal, so a malformed line costs you nothing.

Addresses of **real, already-installed Unifi customers** are the highest-yield
source: they are serviceable by definition. The WifiBizz activated cases in Neon
are full of them.

---

## 5. Probe first — nothing is written

```bash
npx tsx scripts/seed-orders.ts \
  --user <bizzflow-login-email> \
  --addresses ./addresses.txt \
  --probe-only
```

This runs the whole pipeline except the database write. For each line it prints
the portal's own address text, every offer the portal listed, and which package
would be picked — or the reason it was skipped.

Read the output before continuing. If most lines are skipped, the fix is the
address file, not the run.

---

## 6. Seed the drafts

Drop `--probe-only`, and cap the run:

```bash
npx tsx scripts/seed-orders.ts \
  --user <bizzflow-login-email> \
  --addresses ./addresses.txt \
  --limit 3
```

`--limit` counts **drafts written**, not lines read, so skipped addresses do not
eat the budget.

Add `--with-device` when the sub-product tabs, the stock check and the delivery
address are the point. Leave it off otherwise: a plain package is the shorter
path to proving the submit works at all.

Each draft gets a fake but coherent customer — an ID that parses, a real
birthdate, a matching gender — and carries the remark
`SEED DRAFT — generated test data, not a real customer.`

---

## 7. Check the drafts in the UI

Open `/dashboard/order-entry/drafts`. For each seeded row confirm:

- The **installation address** is the portal's wording, not what you typed.
- The **package** is one the probe reported for that address.
- **Details → Order tab** shows the customer fields filled and coherent.
- The row can be **opened for edit and re-saved** without a validation error. If
  it cannot, the row is unusable and the address normalisation needs a look.

---

## 8. Submit one — the part that costs money

**Submit exactly one draft first**, and watch it.

1. Row menu → Submit.
2. Follow the live checklist and the capture trail on the details panel.
3. A finished run reads 17/17 and ends at Submitted.

If it fails, the failure screenshot and the error code name the step. Fix,
resubmit that draft, and only move on once one order has gone all the way
through.

Batch submit only after a single one has succeeded.

---

## 9. Clean up — do not skip this

| What you made | What to do |
| --- | --- |
| Drafts never submitted | Delete them from the Orders table |
| An order the portal **numbered** (`order_entered`, `warning`, `submitted`) | **Void it in the Unifi portal.** Deleting or cancelling in BizzFlow is bookkeeping only — the order stays live at Unifi |
| Customer profiles | Nothing to do — seeding creates none; a submit does |

Keep a note of every portal order number you create. The project already carries
a backlog of stranded orders that need voiding, and it grew because this step
was left for later.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `404` on the probe route | Stale Flask process | Restart `api_server` (step 2) |
| `Stopped: … refused the token` | `ORDER_ENTRY_API_TOKEN` mismatch | Match `.env` to the value the service is running with |
| `Stopped: No usable dealer session` | Session expired or never connected | Reconnect (step 3) and rerun |
| Every line "not found by address search" | Wrong state, or keywords the portal's database does not hold | Try the address without the unit number; confirm the state is right |
| "listed no offers at all" | The address is genuinely not TM-serviceable | Use a different address — this is the tool working, not failing |
| A draft cannot be re-saved in the UI | The portal's address text fails our validation | Report it; the script normalises whitespace but not every portal quirk |

---

## What the script never does

- Submit, pay, or click Order.
- Create a customer profile in Unifi's CRM.
- Write a draft for an address the portal did not list offers for.
- Substitute a package the portal did not offer at that address.
