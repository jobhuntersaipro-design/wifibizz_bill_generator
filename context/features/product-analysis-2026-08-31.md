# BizzFlow — Product Analysis and Plan

**Date:** 2026-08-31 · **Status:** ANALYSIS FOR REVIEW — nothing here is built or scheduled.
**Framing (user, 2026-08-31):** agents first; both the Order Entry and WifiBizz/bill sides are active;
**50+ agents** over the coming months; motion = animated state illustrations + micro-interactions +
a recurring mascot, **not** literal GIFs.

Everything below is grounded in the code as it stands today. Where a gap is inferred rather than
observed, it says so.

---

## 1. Where the product is

Two products under one login. **Order Entry** — a draft form, a one-click submit that drives the Unifi
dealer portal through a headless browser on a droplet, batch submit, auto-retry, live progress, capture
trail, e-mail on completion. **WifiBizz** — crawl a WifiBizz account's activated cases, generate six
document types per case, combine them into one PDF, track case-credit usage.

Shipped in the last 48 hours: the submit lock can no longer wedge; per-agent concurrency (inert at
`N=1`); admin oversight of every order including deleted; per-agent connection state, a live-jobs
panel, chart filters, an agent page; a mobile-navigable admin.

**What is genuinely strong:** the submit pipeline is unusually well instrumented — every attempt is
photographed, every failure classified, every decision documented. The admin now sees what agents
cannot. Tests cover the logic that would fail silently.

**What the survey found about the shape of the app**, stated because it drives the plan:

| Fact | Consequence |
|---|---|
| `OrderForm.tsx` is **2,035 lines** in one file | The most-used screen is the hardest to change safely. Every agent-side improvement below touches it |
| Roles are two booleans — `orderEntryEnabled`, `isSuperAdmin` | At 50+ agents there is no "team lead", no "read-only", no "can submit but cannot delete" |
| No password reset, no onboarding, no self-service | Every new agent is an admin action; every forgotten password is a support ticket |
| The only completion signal off-screen is **e-mail** | An agent who closes the tab learns the outcome from their inbox — or not at all, until they reload |
| Users table shows the agent's **raw password** to admin | Fine at 5 agents you know; a liability at 50 |
| 5 Lottie spots + 1 robot, all on Order Entry | The WifiBizz half has none; the mascot exists but only in one state |

---

## 2. Agent point of view — what is missing

Ordered by how often an agent would hit it. Each names the evidence.

### A1. Knowing the outcome without watching
A submit takes minutes. Today the agent either watches the checklist or waits for an e-mail. **There is
no in-app notification**: no badge, no toast on return, no "3 orders finished while you were away".
At 50 agents each doing several a day, the inbox becomes the UI. — *Observed: no notification surface in
`src/components/order-entry` beyond the batch dialog.*

### A2. Recovering from a failure without a decoder ring
The failure copy is good, but the **next action** is still the agent's to work out: fix the field,
resubmit, wait for the retry, or void at Unifi. Only 8 of ~55 scraper codes have copy. A failure card
should say *"Fix the device and resubmit"* with the field already focused, not just what went wrong.
— *Observed: `SUBMIT_ERROR_CODES` covers 8 codes; the form has no "jump to field" from a failure.*

### A3. The form is one long page
Customer, contact, address, package, device, appointment, documents, remarks — one scroll. Required
fields are counted in a sticky bar (good), but an agent cannot tell *which section* is incomplete
without scrolling. — *Observed: 2,035-line single component; `missingRequired` is a flat list.*

### A4. Repeat customers start from zero
Every draft is typed from scratch. A returning customer (second line, upgrade, resubmit after void) has
no "start from this order". The portal itself dedupes on IC; we do not surface that we have seen the
IC before until the submit hits "multiple customer records". — *Observed: no duplicate-IC hint on the
form; no clone action.*

### A5. Self-service that does not exist
No password change, no password reset, no profile. The dealer-account connection is the ONE thing an
agent manages themselves, and it expires with no warning until they try to submit. — *Observed:
`/auth` has only `signin`; the connection countdown exists on the Order Entry page but nowhere else.*

### A6. Mobile is a second-class agent surface
The Orders list has a card view under 768px and pull-to-refresh, but the **New Order form** at 375px
is a very long scroll with dropdowns that are hard to hit, and the document uploader assumes a file
picker. Agents on the road with a phone are plausible at 50+. — *Partly inferred: the form has been
checked for overflow, not for thumb-usability.*

### A7. WifiBizz side: the same gaps, plus one bug
No progress for a long crawl beyond a spinner; the six document buttons each download separately with
no "generate everything for this case" (Order Entry has this; the case list does not); and the
**state-matcher bug is still open** — `81200 JOHOR BAHRU JOHOR` becomes `81200 BAHRU JOHOR` on both
bill generators (the letter and TIME invoice escaped it; the two bills did not). — *Observed, and
documented as "left alone by the user's call" on 2026-08-22.*

---

## 3. Admin point of view — what is missing

### B1. Roles
Two booleans cannot express a team of 50. The minimum set: **agent**, **team lead** (sees their team's
orders, cannot edit users), **admin**. Superadmin today can submit *another agent's* draft under their
own session, which is powerful and unlogged.

### B2. An audit trail for people, not just orders
Orders have an append-only history. **Users do not.** Who enabled order entry for whom, who topped up
whose limit, who restored a deleted order, who released a stuck job — none of it is recorded.
`CaseLimitChangeLog` exists for one of these; nothing else does.

### B3. Onboarding
Creating an agent is: admin types a password, tells the agent, agent signs in, agent connects the
dealer account. At 50 that is an invite link with a set-your-own-password step, and a checklist the
agent sees until the dealer account is connected.

### B4. The things offered and not picked last round
Search across all orders (name / IC / reference / portal number); a stuck-order sweep; bulk purge of
deleted orders older than N days; CSV export. **Search is the one that will be asked for first** — at
hundreds of orders, filters alone will not find one.

### B5. Alerting, not just reporting
Everything admin sees today is pull. Nothing pushes: no "an agent has failed 5 times today", no "the
submit lock has been held 40 minutes", no "3 agents' sessions expire in the next hour". The cron sweep
logs a stuck lock to the console, where nobody reads it.

### B6. The raw-password column
Removing it is a security decision, not a UX one, and it is the user's to make. Named here because a
plan for 50 agents that leaves it in should do so on purpose.

---

## 4. UI/UX and motion

### What to keep
The Stripe palette, the tabular numerics, the sticky save bar, the capture carousel, the honest dialog
copy. The 5 Lottie spots are well placed and reduced-motion safe. **Keep that rule absolute:** every
new animation renders a static fallback under `prefers-reduced-motion`, because the existing ones do
and a mixed app is worse than a plain one.

### Motion plan — the three things chosen

**Animated state illustrations.** Extend the 5 spots to the states that today show text on a grey box:

| Where | Today | Spot |
|---|---|---|
| Orders list, no drafts | `empty-orders` ✓ | — |
| Case list, no cases crawled | text | `empty-cases` |
| Crawl running | spinner | `crawling` (reuse `processing`) |
| Admin Running now, idle | text | `idle` |
| Admin error breakdown, none | text | `all-clear` |
| Failure card on an order | red box | `error` — short, not a loop |
| Order submitted (detail hero) | `success` ✓ | — |
| Session expired | red banner | `disconnected` |
| Document combined | toast | `merged` |

**Micro-interactions.** Small, fast, and only where they carry information:
- KPI tiles **count up** on load and on range change (a number that jumps reads as a glitch; one that
  counts reads as fresh).
- Table rows **slide in** on filter change, and a row that changes status **flashes** its pill once.
- The submit button becomes the progress bar — press → fills → checklist, one continuous element
  rather than a button that disappears and a panel that appears.
- Toggles animate; the Connection badge pulses once when it turns green.
- **Confetti on a first successful submit of the day**, per agent. Once. Not every time.

**The mascot.** The robot exists in exactly one pose. Give it a family of states and use it as the
face of the app's *feelings*, never as decoration:

| State | Where |
|---|---|
| working (exists) | submit in progress |
| celebrating | order submitted |
| confused | a failure needing the agent |
| sleeping | nothing running / empty states |
| waving | sign-in, onboarding checklist |
| reading | crawl running, OTP reading |

Same 192px WebP + static PNG pattern as today, generated from one source so the character is
consistent. A mascot that appears in three styles is worse than none.

### UX fixes that are not motion
- **Section-aware required-field bar**: *"2 left in Address, 1 in Documents"*, each a scroll-to link.
- **Failure → action**: every failure card gets a primary button (Fix the field / Resubmit / Wait for
  retry / Check at Unifi), driven by a per-code table so it cannot be forgotten for a new code.
- **A persistent status strip** above the Order Entry tabs: connection countdown + submits running +
  last outcome, visible on every tab, not only the connect card.
- **Order list search box** that also matches the portal order number.

---

## 5. Suggested plan

Sized so each phase is one branch and one deploy. Agent-first, as asked.

| # | Phase | Why this order | Size |
|---|---|---|---|
| 1 | **Failure → action + section-aware required bar** (A2, A3) | Cuts failed submits and time-per-order. Touches the form, so it goes first while the form is still one file | M |
| 2 | **In-app outcome notifications** (A1) | Badge on the Orders tab + toast on return + a "finished while away" list. Reuses the webhook that already fires | M |
| 3 | **Motion pack 1** — state spots + KPI count-ups + row transitions | Cheap, visible, builds on existing `LottieSpot`. Ships the reduced-motion rule for everything after | S |
| 4 | **Self-service** — password change, reset by e-mail, expiring-session warning everywhere (A5) | Prerequisite for 50 agents; removes the raw-password column's reason to exist | M |
| 5 | **Roles + people audit trail** (B1, B2) | A migration and a permission layer. Everything admin-side after this depends on it | L |
| 6 | **Onboarding** — invite link, set password, connect-dealer checklist with the waving mascot (B3) | Needs roles and reset flows to exist | M |
| 7 | **Mascot family + micro-interactions on actions** | The character is only worth it once there are states to express | M |
| 8 | **Admin search, alerting, bulk purge, CSV** (B4, B5) | Each small; grouped because they share the oversight page | M |
| 9 | **Clone order + duplicate-IC hint** (A4) | Nice; lower frequency than the above | S |
| 10 | **WifiBizz parity** — generate-all on case list, crawl progress, fix the state matcher (A7) | Kept last only because agents-first was the call; the state-matcher bug is a real defect and could be pulled forward | M |

**Deliberately not in the plan:** splitting `OrderForm.tsx`. It should happen — Phase 1 will make the
case — but "refactor the biggest file" is not a feature, and doing it unasked on the live submit path
is how a working form breaks. Proposed as its own decision after Phase 1.

---

## 6. Decisions (user, 2026-08-31)

| # | Question | Answer | Effect on the plan |
|---|---|---|---|
| 1 | Team lead role? | **No** — agent / admin only | Phase 5 shrinks to the people audit trail; no new role, no permission layer |
| 2 | Raw password column? | **Keep** | Stays; noted as a deliberate choice, not an oversight |
| 3 | WhatsApp / Telegram notifications? | **No** — in-app only | Phase 2 is in-app only |
| 4 | Mascot family? | **No** | Phase 7 dropped; the robot stays in its one pose |
| 5 | Confetti? | **No** | Dropped from motion pack 1 |
| 6 | Fix the state-matcher bug? | **No** — still leave it | Stays documented as a known defect |

### Plan as it stands after the decisions

| # | Phase | Size |
|---|---|---|
| 1 | Failure → action + section-aware required bar | M |
| 2 | In-app outcome notifications | M |
| 3 | Motion pack — state spots + KPI count-ups + row transitions (no confetti, no mascot) | S |
| 4 | Self-service — password change, reset by e-mail, expiring-session warning everywhere | M |
| 5 | People audit trail (no roles) | S |
| 6 | Onboarding — invite link, set password, connect-dealer checklist | M |
| 7 | Admin search, alerting, bulk purge, CSV | M |
| 8 | Clone order + duplicate-IC hint | S |
| 9 | WifiBizz parity — generate-all on case list, crawl progress (state matcher left as-is) | S |
