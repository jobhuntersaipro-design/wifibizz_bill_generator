# SOP — The Scraper Droplet: How It Connects, and How to Update It

Operating procedure for the Playwright/Flask order-entry service running on
DigitalOcean. For **first-time provisioning** (creating the droplet, DNS, swap,
firewall) see [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md) — this document
covers **how the pieces connect** and **routine code updates** thereafter.

| | |
|---|---|
| Host | `scraper.bizzflow.top` → `157.245.150.124` (SGP1) |
| Repo on droplet | `/opt/bizzflow/repo` (sparse checkout of `scraper/` only) |
| App directory | `/opt/bizzflow/repo/scraper` — compose runs here |
| Deploy method | **git tag → `deploy.sh` on the droplet** |
| Source of truth | `scraper/` in this repo, at a tagged commit |

> **Migrating from the old rsync workflow?** Do §7 once, then never again.

---

## 1. Why git, and what it buys you

The old procedure was `rsync` from a Mac working tree. That works, but it has
four failure modes that cost real time:

| rsync | git tag + `deploy.sh` |
|---|---|
| Deploys whatever is on your disk — uncommitted edits, a half-finished branch | Deploys a named commit that exists on GitHub. If it isn't pushed, it can't ship |
| Nothing on the box says what version it is | `git describe` and `.last-deploy` name it exactly |
| Rollback = "find the old code and push it again" | `deploy.sh --rollback`, one command |
| A hand-edit on the droplet is silently overwritten, or silently survives | `deploy.sh` refuses to run until the drift is reconciled |

Two properties are worth stating plainly, because they are the actual
discipline:

- **The droplet only ever pulls.** It holds a read-only deploy key. A
  compromised droplet cannot push to your repo.
- **Untracked files are never touched.** `.env`, `sessions/`, `config/` and
  `logs/` live inside the working tree but are git-ignored, so a checkout walks
  straight past them. This replaces the load-bearing `--exclude` list that rsync
  needed, where one typo cost you the API token.

---

## 2. How it all connects

```
Your Mac ──git push──► GitHub ◄──git fetch (deploy key, read-only)── droplet
                                                                       │
                                              /opt/bizzflow/repo/scraper
                                                      │
                                              docker compose
                                                ├── caddy    :80/:443 ← public HTTPS
                                                └── scraper  :5000    ← internal only
                                                      ▲
Browser ──► Vercel (Next.js) ──────HTTPS─────────────┘
              SCRAPER_API_URL         X-Internal-Token
```

### The three links in the chain

**1. Browser → Vercel.** Normal Next.js. Nothing to do with the droplet.

**2. Vercel → droplet.** Server-side only — the browser never talks to the
scraper directly. Two Vercel environment variables define the link:

| Variable | Meaning |
|---|---|
| `SCRAPER_API_URL` | `https://scraper.bizzflow.top` |
| `ORDER_ENTRY_API_TOKEN` | shared secret, **must match the droplet's `.env` exactly** |

Every call sends the secret as an `X-Internal-Token` header
([api_server.py:266](api_server.py)). A mismatch is the single most common cause
of "the order service is unreachable" — the token is checked before anything
else happens.

**3. Caddy → Flask.** Caddy owns ports 80/443, terminates TLS with an automatic
Let's Encrypt certificate, and reverse-proxies to the `scraper` container on port
5000 ([Caddyfile](Caddyfile)). The Flask container is `expose`d, not `ports`d —
it is **not reachable from the internet**, only through Caddy. Caddy gets the
hostname from `SCRAPER_DOMAIN` in the droplet's `.env`, and that name must match
the DNS A record or certificate issuance fails.

### What runs in the container

`gunicorn -w 1 -k gthread --threads 8 --timeout 600` ([Dockerfile](Dockerfile)).

**One worker, deliberately.** Job state and dealer portal sessions live in
process memory. A second worker would answer half the polls from a process that
has never heard of the job. **Never scale this to multiple workers or replicas.**

### State that survives a restart, and state that does not

Three host directories are bind-mounted into the container. All three now sit
inside the git working tree and are git-ignored ([.gitignore](.gitignore)):

| Mount | Holds | Survives restart |
|---|---|---|
| `./sessions` | dealer portal cookies per user | ✅ file survives, but the portal expires it server-side (~15 min) anyway |
| `./config` | encryption key, `gmail_token.json` | ✅ |
| `./logs` | job logs + error screenshots | ✅ |
| *(memory)* | **in-flight jobs, live dealer logins** | ❌ **lost on every restart** |

That last row is the operationally important one — it is why §4 starts by asking
you to pick your moment.

### The compose project name is pinned

[docker-compose.yml](docker-compose.yml) declares `name: bizzflow-scraper`.
Compose otherwise names the project after its directory, and this migration
moves that directory. Without the pin you would get a second set of containers
and — much worse — a fresh `caddy_data` volume, discarding the Let's Encrypt
account and certificate. **Do not change or remove that line.**

### Where order screenshots go

Captures do **not** stay on the droplet. The scraper uploads them straight to
Cloudflare R2 under `order-screenshots/<userId>/<orderId>/`, and BizzFlow serves
them back through an auth-gated route. The droplet reads the same four R2
variables it already needs to *download* customer documents for attachment
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`),
so no new configuration is required for capture to work.

---

## 3. Prerequisite: SSH access

Everything below needs your public key on the droplet. Check it works:

```bash
ssh root@scraper.bizzflow.top 'hostname'
```

If that returns `Permission denied (publickey)`, your key is not installed on
this machine. Add it via the DigitalOcean console (Droplet → Access → Launch
Recovery Console) or from a machine that already has access:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@scraper.bizzflow.top
```

This is **your** key, for operating the box. It is separate from the droplet's
own deploy key, which only talks to GitHub — see §7.2.

---

## 4. SOP: shipping a change

### Step 0 — Choose the moment (do not skip)

Deploying **restarts the container and wipes memory**. Consequences:

- Every connected user must reconnect their dealer account via OTP.
- Any **in-flight submit is lost**. BizzFlow handles this correctly rather than
  silently — the order finalizes to `warning` with "the submit run was lost (the
  order service restarted)" — but a real order may exist in the Unifi portal and
  someone has to verify it by hand.

`deploy.sh` asks the running service directly — `/health` reports `active_jobs`,
an exact count of queued and running jobs — and stops if anything is in flight.
You can check the same thing yourself at any time:

```bash
curl -s https://scraper.bizzflow.top/health
# {"status":"healthy","active_jobs":0,...}   ← 0 means safe to deploy
```

That covers scrapes and order submits, which share the `JOBS` registry. It does
**not** know about a dealer who is midway through connecting via OTP — they will
simply have to start again.

### Step 1 — Verify locally (on your Mac)

The droplet is not a test environment.

```bash
cd /Users/chrislam/wifibizz_bill_generator/scraper
./venv/bin/python -m pytest tests/ -q          # must be green
./venv/bin/python -m py_compile *.py
```

A syntax error reaches the droplet as a container that boots, crashes, and
restarts forever. `deploy.sh` now catches that and rolls back — but a green test
run is cheaper than a failed deploy.

### Step 2 — Commit and push

Nothing deploys from your working tree any more. It has to be on GitHub.

```bash
cd /Users/chrislam/wifibizz_bill_generator
git status --short scraper/        # expect: clean, or only your intended change
git add scraper/ && git commit -m "fix(scraper): ..."
git push origin <branch>
# …merge to main as usual…
```

### Step 3 — Cut a release tag

Tags are the release names. Prefix them `scraper-v` so the scraper's releases
stay distinguishable from anything you tag for the web app later. Date-plus-
sequence reads well in a list and never needs a version-number decision:

```bash
git checkout main && git pull
git tag -a scraper-v2026.08.17-1 -m "capture trail: 9 slots, JPEG q80"
git push origin scraper-v2026.08.17-1
```

Second deploy the same day is `-2`, and so on.

> **Why tag rather than track `main`?** Because "what is running in production"
> becomes a thing you can *name*, in a bug report or a rollback, six weeks later.
> `git describe` on the droplet answers it in one word.

### Step 4 — Deploy

```bash
ssh -t root@scraper.bizzflow.top /opt/bizzflow/repo/scraper/deploy.sh scraper-v2026.08.17-1
```

Use `ssh -t`. Without a terminal the confirmation prompt cannot be shown, and
`deploy.sh` will refuse rather than assume.

Omit the tag to deploy the newest `scraper-v*` tag. [deploy.sh](deploy.sh) then,
in order:

1. **Refuses** if tracked files were hand-edited on the droplet (see §6).
2. Fetches, resolves the tag, prints the commit range you are about to ship.
3. Asks `/health` for `active_jobs` and stops if work is in flight. If the
   running build predates that field — including the deploy that first ships it
   — it falls back to job-log timestamps and says so.
4. Checks out the tag, `docker compose up -d --build`.
5. Polls `/health` for up to 120 s — and **if it never comes healthy, checks the
   previous commit back out, rebuilds, and reports the failure.**
6. Writes `.last-deploy` so `--rollback` knows where to go.

### Step 5 — Functional check (still yours to do)

`/health` proves Flask is up; it proves nothing about Playwright, the portal, or
your change. `deploy.sh` says so at the end on purpose. Do a real round-trip:

1. Sign into BizzFlow, open **Order Entry**.
2. **Connect Unifi Dealer Account** → OTP → connected.
   *(This is also the bot-detection check — the droplet is a datacenter IP.)*
3. **New Order** → search an address. A result list proves the full chain:
   Vercel → Caddy → Flask → Playwright → the Unifi portal.

Then assert on something specific to *your* change:

```bash
ssh root@scraper.bizzflow.top \
  'grep -c capture_and_report /opt/bizzflow/repo/scraper/oe_feasibility.py'
```

---

## 5. Rollback, and switches that need no deploy

### Rollback

```bash
ssh -t root@scraper.bizzflow.top /opt/bizzflow/repo/scraper/deploy.sh --rollback
```

That returns to whatever was running before the last deploy, recorded in
`.last-deploy`. To go somewhere specific instead, name the tag:

```bash
ssh -t root@scraper.bizzflow.top /opt/bizzflow/repo/scraper/deploy.sh scraper-v2026.08.16-1
```

**What is running right now?**

```bash
ssh root@scraper.bizzflow.top 'cd /opt/bizzflow/repo && git describe --tags --always && cat scraper/.last-deploy'
```

### Switches

Several behaviours are switchable **without a deploy at all** — edit
`/opt/bizzflow/repo/scraper/.env` and `docker compose up -d` (no `--build`):

| Variable | Effect |
|---|---|
| `OE_CAPTURE=false` | stop taking order screenshots entirely |
| `OE_CAPTURE_SLOTS=page1,broadband` | take only these frames |
| `ORDER_ENTRY_DO_PAY` | the Pay gate — leave `false` until a real payment is verified |
| `OE_ORDER_TIMEOUT` | overall order timeout in seconds (default 600 for a full order) |

Prefer a switch over a deploy when you are firefighting: it does not rebuild
Chromium, and it is faster.

Note it still **restarts the container**, so it still costs everyone their
dealer session and kills in-flight submits. There is no such thing as a free
change here — only a cheaper one.

---

## 6. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| `deploy.sh` says "local modifications on the droplet" | someone edited tracked files on the box | see below |
| `deploy.sh` says "no scraper-v* tags exist yet" | you pushed the commit but not the tag | `git push origin --tags` |
| Deploy rolled itself back | new code fails to boot | read the container logs it printed; reproduce locally |
| BizzFlow: "order service unreachable" | token mismatch, or the container is down | `curl https://scraper.bizzflow.top/health`; compare `ORDER_ENTRY_API_TOKEN` in Vercel against the droplet `.env` |
| `/health` times out | Caddy or the container is down | `docker compose ps`, `docker compose logs caddy` |
| Certificate errors | `SCRAPER_DOMAIN` ≠ the DNS A record | `docker compose logs caddy`, `dig +short scraper.bizzflow.top` |
| Container restart-looping | Python syntax/import error | `docker compose logs --tail=100 scraper` |
| Submits die partway, no clear error | Chromium OOM on the 1 GB droplet | `free -h` (swap must be on), `docker stats`; size the droplet up |
| Everyone logged out at once | the container restarted | expected — sessions are in memory |
| Portal login suddenly challenged/blocked | bot detection on the datacenter IP | needs a residential proxy in front of login |

**Reconciling a hand-edit on the droplet.** `deploy.sh` stops rather than
destroying someone's work. Look at it, then choose:

```bash
ssh root@scraper.bizzflow.top 'cd /opt/bizzflow/repo && git diff'

# Worth keeping → copy it into the repo on your Mac, commit, tag, deploy.
# Not worth keeping → discard it:
ssh root@scraper.bizzflow.top 'cd /opt/bizzflow/repo && git checkout -- .'
```

> **Never run `git clean -fdx` on the droplet.** Untracked is exactly what the
> `.env`, dealer sessions, encryption key and Gmail token are. `git clean` is
> the one git command that can destroy the box's state, and nothing in this SOP
> needs it.

**Reading the logs.** Job logs and error screenshots land in
`/opt/bizzflow/repo/scraper/logs` (bind-mounted, so they survive restarts):

```bash
scp root@scraper.bizzflow.top:/opt/bizzflow/repo/scraper/logs/<file>.png .
```

**Capture health.** A healthy submit prints one line per frame naming the portal
geometry:

```
    portal frame 3241px in a 620px box — shot <body>
```

If you instead see `⚠ frame shot failed … falling back to the outer page`, the
screenshots are being clipped to the slice of the portal that fits in its iframe
— they will look plausible but be missing everything below the fold.

---

## 7. One-time migration: rsync → git

Run this **once**, on a quiet moment, with nobody submitting. It converts the
droplet in place and keeps every piece of its state.

### 7.1 Prepare on your Mac

Commit the deploy machinery and cut the first tag:

```bash
cd /Users/chrislam/wifibizz_bill_generator
git add scraper/deploy.sh scraper/.gitignore scraper/docker-compose.yml scraper/SOP_DROPLET_UPDATE.md
git commit -m "chore(scraper): git-based deploy — deploy.sh, .gitignore, pinned compose project"
git push origin <branch>          # …and merge to main

git checkout main && git pull
git tag -a scraper-v2026.08.17-1 -m "first git deploy"
git push origin scraper-v2026.08.17-1
```

Confirm nothing sensitive is tracked — this must print nothing:

```bash
git ls-files scraper/ | grep -Ei 'venv|sessions/|config/|logs/|\.env'
```

### 7.2 Give the droplet a read-only deploy key

Generate it **on the droplet** so the private key never travels:

```bash
ssh root@scraper.bizzflow.top
ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519_deploy -C 'bizzflow-scraper droplet'
cat /root/.ssh/id_ed25519_deploy.pub
```

Paste that public key into GitHub → the repo → **Settings → Deploy keys → Add
deploy key**. Title it `scraper droplet`. **Leave "Allow write access"
unchecked** — the droplet has no business pushing.

Tell git which key to use, then prove it:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/id_ed25519_deploy
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config

ssh -T git@github.com     # expect: "Hi <repo>! You've successfully authenticated,
                          # but GitHub does not provide shell access."
```

### 7.3 Clone, sparse, in place

Still on the droplet. Sparse checkout needs git ≥ 2.25 — Ubuntu 22.04 ships
2.34, but check:

```bash
git --version
```

```bash
mkdir -p /opt/bizzflow
git clone --filter=blob:none --no-checkout \
    git@github.com:jobhuntersaipro-design/wifibizz_bill_generator.git \
    /opt/bizzflow/repo
cd /opt/bizzflow/repo
git sparse-checkout set scraper
git fetch --tags
git checkout --force --detach scraper-v2026.08.17-1
ls scraper/          # the scraper's files, and nothing from the Next.js app
```

### 7.4 Move the droplet's state across

This is the step to get right. Stop the old stack first so nothing is written
mid-move:

```bash
cd /opt/bizzflow-scraper
docker compose down

mv .env      /opt/bizzflow/repo/scraper/
mv sessions  /opt/bizzflow/repo/scraper/
mv config    /opt/bizzflow/repo/scraper/
mv logs      /opt/bizzflow/repo/scraper/

cd /opt/bizzflow/repo/scraper
ls -a .env sessions config logs        # all four present
git status --short                     # MUST be empty — if these show up,
                                       # .gitignore did not come across
```

### 7.5 Bring it up on the new path

```bash
cd /opt/bizzflow/repo/scraper
docker compose up -d --build
docker compose ps                      # project should read bizzflow-scraper
curl -s https://scraper.bizzflow.top/health
```

Certificates live in the `caddy_data` volume, which the pinned project name
preserves — Caddy should **not** re-request one. If it does, check that
`name: bizzflow-scraper` survived in `docker-compose.yml`.

### 7.6 Retire the old directory

Keep it for a week as a safety net, then remove it. Leave a note so nobody
deploys to a ghost:

```bash
echo "MOVED to /opt/bizzflow/repo/scraper on $(date -I). Deploy with deploy.sh — see SOP." \
  > /opt/bizzflow-scraper/README.MOVED

# after a week, once you trust it:
# rm -rf /opt/bizzflow-scraper
```

Finally, do a real deploy end to end to prove the loop works:

```bash
ssh -t root@scraper.bizzflow.top /opt/bizzflow/repo/scraper/deploy.sh
```

---

## 8. Known gaps in this document

1. **None of §7 has been executed.** The migration was written against the
   repo, `docker-compose.yml` and the previous SOP — not against the running
   box, which has never been inspected from this machine (no SSH key was
   available). Expect to correct small details on first run, and correct them
   *here*.
2. **`active_jobs` has not run on the droplet yet.** It is verified locally —
   the count is exact, and it exposes no job ids or parameters, which matters
   because Caddy serves `/health` publicly with no token check. But the first
   deploy that carries it necessarily runs its guard against the *old* build,
   so the fallback path is what protects that one deploy. Confirm the field
   appears afterwards:
   `curl -s https://scraper.bizzflow.top/health`

   Its blind spot is worth knowing: it counts entries in the `JOBS` registry, so
   it sees scrapes and order submits but not a dealer half-way through an OTP
   login.
3. **[DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md) contains two stale
   claims**: it says `scraper/` is git-ignored (it is tracked), and step 5 tells
   you to `cp .env.production.example .env` — that file does not exist in the
   repo. If you are provisioning a fresh droplet, write the `.env` by hand. It
   also still describes the rsync deploy, which this document replaces.
