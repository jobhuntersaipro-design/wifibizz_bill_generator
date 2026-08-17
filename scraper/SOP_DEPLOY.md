# SOP — Update the scraper on the droplet

The short, everyday version. For one-time setup (deploy key, first clone,
rsync→git migration) and troubleshooting, see
[SOP_DROPLET_UPDATE.md](SOP_DROPLET_UPDATE.md).

**The loop:** commit on your Mac → push → cut a tag → run `deploy.sh` on the
droplet. The droplet only ever *pulls*. Never edit code on the box.

---

## 1. On your Mac — commit and push

```bash
cd /Users/chrislam/wifibizz_bill_generator
git status --short              # nothing under scraper/ left uncommitted
git add scraper/
git commit -m "fix(scraper): what changed"
git push origin <your-branch>
```

Confirm no secrets are tracked — this must print nothing:

```bash
git ls-files scraper/ | grep -Ei 'venv|sessions/|config/|logs/|\.env'
```

## 2. Cut a new tag

`deploy.sh` with no argument deploys the **newest `scraper-v*` tag**.

```bash
git tag -a scraper-v$(date +%Y.%m.%d)-1 -m "what changed"
git push origin --tags
```

Second deploy the same day → `-2`, then `-3`, and so on.

> **Always cut a new tag. Never move an existing one.** The droplet fetches
> with `git fetch --tags` (no `--force`), so a force-moved tag is silently
> ignored and you deploy the old code while believing you shipped the new.

The tag does not have to be on `main` — it just has to be a commit that exists
on GitHub.

## 3. Deploy

From your Mac, one command:

```bash
ssh -t root@scraper.bizzflow.top /opt/bizzflow/repo/scraper/deploy.sh
```

`ssh -t` matters — the script asks for confirmation when a job is in flight, and
without a terminal it aborts instead of asking.

What it does for you: refuses to run if someone hand-edited tracked files on the
box, fetches, warns if a submit or scrape is running, checks out, rebuilds, waits
for `/health`, and **automatically rolls back** if health never comes up.

Variants:

```bash
deploy.sh scraper-v2026.08.17-1   # deploy a specific tag
deploy.sh --rollback              # back to the previously deployed ref
deploy.sh --force <tag>           # skip the in-flight-job confirmation
```

## 4. Verify — the part the script cannot do

A green `/health` only proves the container starts. It says nothing about
Playwright, the dealer portal, or your actual change.

```bash
curl -s https://scraper.bizzflow.top/health
```

Then in the app: run one real action that exercises what you changed — a dealer
login, a scrape, or an order submit — and read the logs:

```bash
ssh root@scraper.bizzflow.top 'ls -lt /opt/bizzflow/repo/scraper/logs | head'
scp root@scraper.bizzflow.top:/opt/bizzflow/repo/scraper/logs/<file>.png .
```

**A rebuild logs every dealer out** (sessions are in memory) and kills any
running submit. Deploy when the box is quiet.

---

## Rules

| | |
|---|---|
| Code path on the droplet | `/opt/bizzflow/repo/scraper` |
| Never edit on the box | `.env`, `sessions/`, `config/`, `logs/` are the only droplet-owned things there |
| Never commit | those same four — they are git-ignored, keep it that way |
| Tags | monotonic, never reused, never moved |

## When something goes wrong

**"someone edited tracked files directly on the box"** — a hand-edit is about to
be destroyed. Copy it into the repo on your Mac and commit it, or discard it:

```bash
ssh root@scraper.bizzflow.top 'git -C /opt/bizzflow/repo checkout -- .'
```

**"no scraper-v* tags exist yet"** — the tag never reached GitHub. `git push
origin --tags` again.

**Deploy says it rolled back** — read the container logs it printed, fix on your
Mac, cut a *new* tag. The old build is already running again; nothing is down.

**Nothing changed after a deploy** — you almost certainly moved a tag instead of
cutting one. Check what the box actually has:

```bash
ssh root@scraper.bizzflow.top 'cat /opt/bizzflow/repo/scraper/.last-deploy'
```
