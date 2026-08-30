# Per-Agent Submit Concurrency

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Depends on:** `fix/stuck-job-lock-visibility` (`b6e012d`) being merged and deployed first. See
[Phase 0](#phase-0--prerequisite-ship-the-reaper-first), which is a hard prerequisite rather than an
ordering preference.
**Target:** 4 concurrent agents on an 8 GB / 4 vCPU droplet. **Ships defaulting to 1** — behaviour
identical to today until one environment variable is changed.

---

## The ask

> Let many agents submit orders at once, but each agent can only have one browser job running at a time.

Today the limit is **one job for the whole droplet**. An agent is refused because *somebody else* is
submitting, on a different dealer account, for a different customer.

---

## Status quo

Measured on the live droplet, 2026-08-30.

| | Today |
|---|---|
| Concurrency limit | **1 job, globally.** Not per agent, not per order |
| Where enforced | `api_server.py`, in `/orders` and `/orders/batch`: a scan of `JOBS.values()` for any `queued`/`running`. **No user id enters the check** |
| Droplet | **1 vCPU / 2 GB RAM** / 2 GB swap / 48 GB disk (the build spec says 1 GB — stale) |
| Process model | gunicorn `-w 1 -k gthread --threads 8`; jobs run as daemon threads; `JOBS` is a plain dict in that one process |
| Job record | `{status, created_at, params: {dry_run, kind}}` — **`user_key` is not stored on the job** |
| Chromium cost | **365 MB RSS** for a blank page, measured in the running container |
| Refusal behaviour | Clean. `409 JOB_IN_PROGRESS` → `startSubmitRun` marks the order `failed` with the message; the row is not stranded |

### What is already safe

Every module-level global in `oe_feasibility.py` and `order_entry.py` is an **immutable constant** —
regexes, selector strings, JS blobs. There is no mutable per-run global state. The order flow is
already effectively reentrant, which is why this is a gate-and-config change rather than a rewrite.

### What is not concurrency-safe today

1. **`logs/debug_{tag}.png`** ([`oe_feasibility.py:3906`](../../scraper/oe_feasibility.py#L3906)) — the
   filename is the failure kind, not the job. Two runs failing the same way overwrite each other's
   diagnostic, and the survivor is indistinguishable from the loser.
2. **`r2_download._client`** — check-then-set lazy init. boto3 clients are thread-safe to *use*, not to
   *create*.
3. **Dealer logins run their own browsers under a separate budget.** `MAX_CONCURRENT_LOGINS = 4` in
   `dealer_login_service.py` knows nothing about order jobs, so 4 logins + N orders is 4 + N browsers.
   See [Phase 3](#phase-3--concurrency-safety-fixes).

---

## Design

### Two levels, not one

| Level | Limit | Why it exists | Tunable? |
|---|---|---|---|
| **Per user** | **1** | Both runs would drive the same `sessions/dealer_<userId>.json` and the same portal account. This is a correctness constraint, not a resource one | **No** — fixed at 1 |
| **Global** | `N` | Machine resources: RAM and CPU for N concurrent Chromiums | Yes, `OE_MAX_CONCURRENT_JOBS` |

Sketch of the gate that replaces the current scan:

```python
MAX_CONCURRENT_JOBS = int(os.environ.get("OE_MAX_CONCURRENT_JOBS", "1"))  # default = today

with JOBS_LOCK:
    _reap_stale_jobs_locked()          # already shipped in b6e012d
    active = [j for j in JOBS.values() if j.get("status") in ("queued", "running")]
    if any((j.get("params") or {}).get("user_key") == user_key for j in active):
        return 409 USER_JOB_IN_PROGRESS
    if len(active) >= MAX_CONCURRENT_JOBS:
        return 409 SERVER_AT_CAPACITY
```

**Two distinct refusal codes, deliberately.** "You already have a submit running" and "every slot is
busy" are different facts and need different sentences in front of an agent — one is their own doing
and will clear when their run ends, the other is a queue they cannot influence. Collapsing them into
one code would put the current vague message back.

### The safety property that shapes the rollout

**With `OE_MAX_CONCURRENT_JOBS=1` the behaviour is byte-identical to today.** Concurrency is raised by
changing one environment variable and restarting, and rolled back the same way — never by shipping
code. That means the risky part of this plan (see [Open risks](#open-risks)) is a variable you can move
in either direction in under a minute, not a deploy you have to revert under pressure.

---

## Sizing

Budget **~700 MB per concurrent job**: 365 MB measured on a blank page, and the Unifi portal is jqGrid,
stacked dialogs, full-page JPEG captures and file uploads on top of that. Base load — OS, gunicorn,
Playwright — is ~1 GB.

| Concurrent agents | RAM needed | Droplet | Verdict |
|---|---|---|---|
| 1 (today) | ~1.7 GB | 1 vCPU / 2 GB | At its limit already |
| 2 | ~2.4 GB | 2 vCPU / 4 GB | Safe, cheap |
| **4 (target)** | **~3.8 GB** | **4 vCPU / 8 GB** | **Chosen.** Comfortable headroom |
| 6–8 | ~5.2–6.6 GB | 8 vCPU / 16 GB | Past here the single process is the limit — see [Beyond N=4](#beyond-n4) |

**CPU is the constraint people under-provision, and the failure mode is expensive.** Chromium rendering
is genuinely CPU-hungry and the droplet has **one core**. Budget roughly 1 vCPU per concurrent job plus
one for the app. Starving it does not merely make runs slow — it pushes them past the 600s
`OE_ORDER_TIMEOUT`, and a submit that times out mid-flight leaves a **real minted order at Unifi**
needing a manual void. Never raise `N` without raising vCPU in the same step.

---

## Phases

### Phase 0 — prerequisite: ship the reaper first

Merge and deploy `b6e012d` before any of this.

Not politeness — a correctness prerequisite. Today a leaked job blocks **everyone**, which is loud and
gets reported within hours. With per-agent slots, a leaked job silently blocks **one agent forever**
while everyone else works normally. That is strictly harder to notice and strictly worse. The reaper,
`GET /jobs` and force-release must exist before slots do.

### Phase 1 — record `user_key` on the job

Pure data. `/orders` and `/orders/batch` already receive `user_key`; it simply is not stored in the job
record. Add it to `params`, and to `_job_summary` so `GET /jobs` names which agent holds each slot.

No behaviour change. Deployable on its own, zero risk. **Nothing in Phase 2 can be built without it.**

### Phase 2 — the two-level gate

The sketch above, in `/orders` and `/orders/batch`, defaulting to `1`.

- A batch holds **one slot for its whole run** — its members are that user's, run sequentially, and must
  not each claim a slot.
- `startSubmitRun` already treats any 409 as `busy` and gives the retry its try back; both new codes
  inherit that unchanged.
- `sweepPendingRetries` gets more useful, not less: deferred retries now compete for N slots instead of 1.

Ships inert. Nothing changes until Phase 4.

### Phase 3 — concurrency-safety fixes

Each of these is a latent bug today and a real one at `N > 1`.

1. **Job-scope the debug screenshot** — `logs/debug_{job_id}_{tag}.png`.
2. **Lock the boto3 client init** in `r2_download`, or build it eagerly at import.
3. **Fold dealer logins into the same capacity budget.** This is the one with teeth: `MAX_CONCURRENT_LOGINS = 4`
   is a *separate* pool, so at `N=4` the worst case is **8 concurrent browsers ≈ 5.6 GB** — over the
   8 GB box's safe ceiling once the base load is counted. One shared budget, with logins and orders
   drawing from it, is what makes the sizing table above true rather than optimistic.
4. **A login must not run while that user has an order job in flight.** Independently of capacity: a
   fresh portal login on the same dealer account mid-run may invalidate the session the run is driving.
   (Whether Unifi actually does this is unknown — see [Open risks](#open-risks). The guard costs little
   and removes the question.)
5. **`deploy.sh` needs a drain mode.** Its current check refuses to deploy while `active_jobs > 0`. With
   N agents submitting, that is almost always true, so deploys become impossible. It needs to stop
   accepting new jobs, wait for the in-flight ones, then rebuild.

### Phase 4 — resize, then ramp

1. Resize to **4 vCPU / 8 GB**. Verify the container comes back and `/health` is idle.
2. `OE_MAX_CONCURRENT_JOBS=2`. Run for a day. Watch: peak RSS, run durations, timeout rate,
   `SERVER_AT_CAPACITY` frequency.
3. `=3`, then `=4`, same observation window at each step.

**Stop and reassess** if run durations climb materially, if the timeout rate rises at all, or if the
portal starts refusing sessions. Each step is one variable and one restart.

Add a **memory safety valve** in the same phase: refuse a new job when available RAM is below a floor,
so the real ceiling is enforced by the machine rather than by a number in an env file that may be wrong.

### Phase 5 — the UI stops lying

`scraperBusy()` moves from the public `/health` count to the auth-gated `GET /jobs` shipped in
`b6e012d`. It already runs server-side in a Server Action with `ORDER_ENTRY_API_TOKEN` available, so no
new endpoint and no new public surface is needed.

`submitBlockedReason` then distinguishes:

| State | Message |
|---|---|
| Your own run in flight | *"You already have a submit running. It has been going for 4m 5s."* |
| All slots busy | *"3 of 4 agents are submitting — your turn shortly."* |
| Stuck (past cap) | *"A task has been stuck on the server for 6h 0m…"* (already shipped) |

`/health` keeps its global count unchanged — `deploy.sh` reads it, and it is served publicly, so it must
not start carrying per-agent state.

---

## Open risks

**1. The portal, and it cannot be settled from here.** N concurrent dealer sessions originate from a
**single datacenter IP**. The build spec already flags DO-IP bot detection as an open risk. Different
agents use different dealer accounts, but the source IP is shared, and Unifi's rate limiting and
concurrent-session policy are both unknown. There is no way to test this except by ramping and watching
— which is the entire reason Phase 4 is one step at a time rather than straight to 4.

**2. `-w 1` becomes load-bearing.** The gate is a dict in one process. Raising gunicorn's worker count
would give **each worker its own registry and its own N**, silently making the real limit N × workers,
with no error anywhere. Pin `-w 1` in the deploy with a comment saying why, and treat "we need more
workers" as the signal to move the registry to Redis rather than as a tuning knob.

**3. The GIL is probably fine, but is not proven.** Playwright is I/O-bound — it talks to Chromium over
a pipe — so N runs in one process should interleave well. But JPEG encoding of captures and JSON
handling are in-process CPU work. At 1 vCPU this is already the bottleneck; at 4 vCPU it should not be.
Unmeasured.

**4. `OE_ORDER_TIMEOUT` may need raising** once runs share CPU. The reaper's cap already derives from it
(`max(1800, cap * 3)`), so raising it is safe and the two cannot drift.

---

## Beyond N=4

If 4 is not enough, the single-process design is the thing to change, not the numbers. The path is to
run **one worker container per slot**, each with its own Chromium and its own memory ceiling, with the
job registry moved to Redis so the gate is shared rather than per-process. That also removes the `-w 1`
fragility and makes deploys drainable per worker. It is a materially larger piece of work and should not
be started until the ramp to 4 shows it is needed.

---

## Review checklist

- [ ] Target of 4 agents on 8 GB / 4 vCPU is the right trade against cost
- [ ] Per-user limit of **1**, fixed and not configurable, is agreed
- [ ] Shipping inert at `N=1` and ramping by env var is the rollout you want
- [ ] Folding dealer logins into the shared capacity budget (Phase 3.3) is agreed — the sizing depends on it
- [ ] The blocking login guard (Phase 3.4) is in scope after all
- [ ] `deploy.sh` drain mode is accepted as a necessary cost of concurrency
- [ ] The portal-side risk is understood as untestable in advance, and the ramp is the mitigation
