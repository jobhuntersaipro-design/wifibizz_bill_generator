#!/usr/bin/env bash
#
# Deploy the scraper on the droplet from a git tag.
#
#   ./deploy.sh                     # deploy the newest scraper-v* tag
#   ./deploy.sh scraper-v2026.08.17-1
#   ./deploy.sh --force <tag>       # skip the in-flight-job confirmation
#   DRAIN_TIMEOUT=0 ./deploy.sh     # do not wait for running jobs (old behaviour)
#   ./deploy.sh --rollback          # go back to the previously deployed ref
#
# This script lives in the repo and therefore replaces *itself* during
# `git checkout`. The whole body is wrapped in { } so bash parses the entire
# file before running any of it — without that, overwriting the file mid-run
# makes bash resume reading at a byte offset into different content.
{
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/bizzflow/repo}"
APP_DIR="$REPO_DIR/scraper"
HEALTH_URL="${HEALTH_URL:-https://scraper.bizzflow.top/health}"
TAG_GLOB="scraper-v*"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"   # seconds to wait for /health after a rebuild
BUSY_WINDOW_MIN="${BUSY_WINDOW_MIN:-10}"  # a job log touched this recently = probably running
# Seconds to wait for in-flight jobs to finish before asking to proceed anyway.
# 0 disables draining and restores the old refuse-immediately behaviour.
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-900}"
STATE_FILE="$APP_DIR/.last-deploy"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31m!!  %s\033[0m\n' "$*" >&2; exit 1; }

FORCE=0
ROLLBACK=0
REF=""
for arg in "$@"; do
  case "$arg" in
    -f|--force)    FORCE=1 ;;
    --rollback)    ROLLBACK=1 ;;
    -h|--help)     sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)            die "unknown option: $arg" ;;
    *)             [ -n "$REF" ] && die "give at most one ref (got '$REF' and '$arg')"; REF="$arg" ;;
  esac
done

[ -d "$REPO_DIR/.git" ] || die "$REPO_DIR is not a git repo — see the SOP, one-time setup"
cd "$REPO_DIR"

# ── 1. Refuse to deploy on top of drift ────────────────────────────────────
# Anything hand-edited on the droplet would be silently destroyed by the
# checkout below. Untracked files (.env, sessions/, config/, logs/) are fine
# and deliberately not considered — only tracked-file changes count.
if ! git diff --quiet HEAD -- 2>/dev/null; then
  say "Local modifications on the droplet"
  git --no-pager diff --stat HEAD
  die "someone edited tracked files directly on the box. Copy the change into
    the repo on your Mac, commit it, then deploy. To discard it instead:
      git -C $REPO_DIR checkout -- ."
fi

# ── 2. Work out what to deploy ─────────────────────────────────────────────
PREV_SHA="$(git rev-parse HEAD)"
PREV_DESC="$(git describe --tags --always 2>/dev/null || echo "$PREV_SHA")"

if [ "$ROLLBACK" -eq 1 ]; then
  [ -n "$REF" ] && die "--rollback takes no ref"
  [ -f "$STATE_FILE" ] || die "no $STATE_FILE — nothing recorded to roll back to"
  # shellcheck disable=SC1090
  REF="$(awk -F= '/^PREVIOUS_REF=/{print $2}' "$STATE_FILE")"
  [ -n "$REF" ] || die "$STATE_FILE has no PREVIOUS_REF"
  info "rolling back to $REF"
fi

say "Fetching from origin"
git fetch --tags --prune --quiet origin
info "ok"

if [ -z "$REF" ]; then
  REF="$(git tag --list "$TAG_GLOB" --sort=-v:refname | head -n1)"
  [ -n "$REF" ] || die "no $TAG_GLOB tags exist yet. Cut one on your Mac:
      git tag -a scraper-v\$(date +%Y.%m.%d)-1 -m 'what changed' && git push origin --tags"
fi

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null \
  || die "ref '$REF' does not exist. Available:
$(git tag --list "$TAG_GLOB" --sort=-v:refname | head -5 | sed 's/^/      /')"

NEW_SHA="$(git rev-parse "$REF^{commit}")"

say "Deploying"
info "from : $PREV_DESC  (${PREV_SHA:0:8})"
info "to   : $REF  (${NEW_SHA:0:8})"
if [ "$NEW_SHA" = "$PREV_SHA" ]; then
  info "already at this commit — rebuilding anyway"
else
  git --no-pager log --oneline --no-decorate "$PREV_SHA..$NEW_SHA" -- scraper/ | sed 's/^/      /' || true
fi

# ── 3. In-flight work guard ────────────────────────────────────────────────
# The container holds job state and dealer sessions in memory. A rebuild
# destroys both, so ask the running service what it is doing.
#
# /health reports active_jobs — an exact count of queued+running jobs from the
# JOBS registry. Two cases give us no answer: the service is down (nothing to
# lose, carry on), or it is running a build from before active_jobs existed,
# including the very deploy that introduces it. Only then do we fall back to
# the old heuristic — a job log written to recently probably means a live run.
BUSY=""
BUSY_WHY=""
HEALTH_JSON="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
ACTIVE="$(printf '%s' "$HEALTH_JSON" | tr -d ' ' | sed -n 's/.*"active_jobs":\([0-9]\{1,\}\).*/\1/p')"

if [ -n "$ACTIVE" ]; then
  if [ "$ACTIVE" -gt 0 ]; then
    BUSY="yes"
    BUSY_WHY="the service reports $ACTIVE job(s) queued or running."
  fi
elif [ -n "$HEALTH_JSON" ]; then
  info "note: this build predates /health active_jobs — falling back to log mtimes"
  RECENT="$(find "$APP_DIR/logs" -maxdepth 1 -name '*.log' -mmin "-$BUSY_WINDOW_MIN" 2>/dev/null | head -5 || true)"
  if [ -n "$RECENT" ]; then
    BUSY="yes"
    BUSY_WHY="these job logs were written in the last $BUSY_WINDOW_MIN minutes:
$(printf '      %s\n' $RECENT)"
  fi
fi

# ── 3b. Drain ──────────────────────────────────────────────────────────────
# With several agents submitting concurrently there is almost always a job in
# flight, so "refuse while busy" would make deploying impossible. Instead wait
# for the runs to finish — a submit is capped at OE_ORDER_TIMEOUT and the
# service reaps anything past it, so this terminates rather than hanging.
#
# It does NOT stop new jobs arriving: that would need a service-side quiesce
# flag, and a deploy that blocks submits while it waits is its own outage. The
# window is small and the confirmation below is still the backstop.
if [ -n "$BUSY" ] && [ "$DRAIN_TIMEOUT" -gt 0 ] && [ -n "$ACTIVE" ]; then
  say "Waiting for $ACTIVE job(s) to finish (up to ${DRAIN_TIMEOUT}s)"
  drain_start=$(date +%s)
  while :; do
    sleep 10
    HEALTH_JSON="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    ACTIVE="$(printf '%s' "$HEALTH_JSON" | tr -d ' ' | sed -n 's/.*"active_jobs":\([0-9]\{1,\}\).*/\1/p')"
    [ -n "$ACTIVE" ] || break                 # service gone: nothing left to wait for
    if [ "$ACTIVE" -eq 0 ]; then
      BUSY=""; BUSY_WHY=""
      info "drained — no jobs in flight"
      break
    fi
    elapsed=$(( $(date +%s) - drain_start ))
    if [ "$elapsed" -ge "$DRAIN_TIMEOUT" ]; then
      BUSY_WHY="still $ACTIVE job(s) after ${DRAIN_TIMEOUT}s of waiting."
      info "gave up waiting: $BUSY_WHY"
      break
    fi
    info "  ${elapsed}s: $ACTIVE still running"
  done
fi

if [ -n "$BUSY" ]; then
  say "Work in flight"
  info "$BUSY_WHY"
  info "a rebuild loses any running submit and logs every dealer out."
fi
if [ "$FORCE" -ne 1 ]; then
  if [ -t 0 ]; then
    printf '\n    Proceed? [y/N] '
    read -r reply
    case "$reply" in [yY]*) ;; *) die "aborted" ;; esac
  elif [ -n "$BUSY" ]; then
    die "work looks in flight and there is no terminal to confirm on.
    Re-run with 'ssh -t' to be asked, or pass --force if you are sure."
  fi
fi

# ── 4. Check out and rebuild ───────────────────────────────────────────────
say "Checking out $REF"
git checkout --force --detach "$NEW_SHA" --quiet
info "$(git describe --tags --always)"

say "Rebuilding containers"
cd "$APP_DIR"
docker compose up -d --build

# ── 5. Verify, and undo it if that fails ───────────────────────────────────
say "Waiting for /health (up to ${HEALTH_TIMEOUT}s)"
healthy=0
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  say "UNHEALTHY — rolling back to ${PREV_SHA:0:8}"
  docker compose logs --tail=60 scraper || true
  cd "$REPO_DIR"
  git checkout --force --detach "$PREV_SHA" --quiet
  cd "$APP_DIR"
  docker compose up -d --build
  for _ in $(seq 1 20); do
    curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 && break
    sleep 3
  done
  die "$REF failed its health check and was rolled back to $PREV_DESC.
    Read the container logs above, fix it on your Mac, cut a new tag."
fi

# ── 6. Prune old job logs and screenshots ──────────────────────────────────
# The service writes one .log per job plus debug screenshots, and nothing ever
# removed them: 74MB / 163 PNGs had accumulated locally by the time anyone
# looked. The droplet is 1GB with swap, so an unbounded logs/ dir eventually
# takes the service down in a way that reads as a Chromium OOM.
#
# Runs AFTER the health check on purpose — the busy-detection above reads log
# mtimes, and the rollback path needs the container logs intact.
# Only touches files older than LOG_RETAIN_DAYS; today's evidence always stays.
LOG_RETAIN_DAYS="${LOG_RETAIN_DAYS:-14}"
if [ -d "$APP_DIR/logs" ]; then
  before="$(du -sh "$APP_DIR/logs" 2>/dev/null | cut -f1)"
  find "$APP_DIR/logs" -maxdepth 1 -type f \( -name '*.log' -o -name '*.png' -o -name '*.jpg' \) \
       -mtime "+$LOG_RETAIN_DAYS" -delete 2>/dev/null || true
  after="$(du -sh "$APP_DIR/logs" 2>/dev/null | cut -f1)"
  say "Pruned logs older than ${LOG_RETAIN_DAYS}d"
  info "logs/: $before -> $after"
fi

# ── 7. Record what happened ────────────────────────────────────────────────
cat > "$STATE_FILE" <<EOF
DEPLOYED_REF=$REF
DEPLOYED_SHA=$NEW_SHA
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PREVIOUS_REF=$PREV_DESC
PREVIOUS_SHA=$PREV_SHA
EOF

say "Deployed $REF"
info "health : $(curl -fsS --max-time 5 "$HEALTH_URL")"
info "rollback with: $APP_DIR/deploy.sh --rollback"
printf '\n'
info "NOT yet proven: Playwright, the dealer portal, or your actual change."
info "Do the functional check in the SOP (§5) before you call this done."
}
