#!/usr/bin/env bash
# One-time (idempotent) environment bootstrap for the BizzFlow app.
#
# This runs as the Cloud Agent `install` step: it provisions durable state
# (system packages, the wsproxy binary, node_modules, the local Postgres schema,
# a demo user). Per-boot process startup lives in scripts/dev/dev-services.sh
# (the `start` step) and the dev-server terminal, not here.
#
# The app talks to Postgres through Neon's serverless driver, which speaks
# WebSockets. Locally there is no Neon endpoint, so we run a plain PostgreSQL and
# a tiny websocket->TCP proxy (Neon's `wsproxy`) and point the driver at it via
# scripts/dev/neon-ws-local.mjs. No application source is modified.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"

echo "==> [1/6] Installing system packages (PostgreSQL, Go, build tools)"
# `apt-get update` returns non-zero if ANY configured source fails, including
# unrelated third-party repos preinstalled in the base image (e.g. the Google
# Chrome repo, which intermittently returns a Hash Sum mismatch). Those failures
# must not abort setup, so tolerate update errors here and let the install step
# below be the real gate — it fails loudly if the packages we need are missing.
sudo apt-get update -y || sudo apt-get update -y || echo "    apt-get update reported errors (continuing)"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  postgresql postgresql-contrib golang-go git ca-certificates

echo "==> [2/6] Building Neon wsproxy (websocket->TCP bridge)"
if [ ! -x /usr/local/bin/wsproxy ]; then
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/neondatabase/wsproxy.git "$tmp/wsproxy"
  ( cd "$tmp/wsproxy" && GOFLAGS=-mod=mod go build -o "$tmp/wsproxy-bin" . )
  sudo install -m 0755 "$tmp/wsproxy-bin" /usr/local/bin/wsproxy
  rm -rf "$tmp"
fi
/usr/local/bin/wsproxy --help >/dev/null 2>&1 || true
echo "    wsproxy: $(command -v wsproxy)"

echo "==> [3/6] Installing Node dependencies (npm ci)"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

echo "==> [4/6] Ensuring .env exists (dev defaults)"
if [ ! -f .env ]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || echo dev-insecure-secret-change-me)"
  cat > .env <<ENV
# Auto-generated local development environment (gitignored). Dev-only values.
DATABASE_URL="postgresql://bizzflow:bizzflow@127.0.0.1:5432/bizzflow"
NEON_WS_LOCAL_PROXY="localhost:5433/v1"
AUTH_SECRET="${SECRET}"
AUTH_TRUST_HOST="true"
WIFIBIZZ_BASE_URL="https://wifibizz.com"
ENV
  echo "    wrote .env"
else
  echo "    .env already present, leaving as-is"
fi

echo "==> [5/6] Starting Postgres + wsproxy and provisioning schema"
bash scripts/dev/dev-services.sh
npx prisma generate
# `prisma db push` syncs the DB directly to schema.prisma. The committed
# migration history is internally inconsistent (several tables/columns were
# created out-of-band in production and later ALTERed), so `migrate deploy`
# cannot build a fresh DB; db push produces the schema the app actually expects.
npx prisma db push

echo "==> [6/6] Seeding a demo login user"
NEON_WS_LOCAL_PROXY="localhost:5433/v1" npx tsx scripts/dev/seed-dev-user.ts || \
  echo "    (seed skipped/failed — non-fatal)"

echo "==> Setup complete. Start the app with: npm run dev (via the configured terminal)"
