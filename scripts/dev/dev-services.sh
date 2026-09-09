#!/usr/bin/env bash
# Start (idempotently) the local backing services the app needs in a Cloud
# Agent / local dev box: PostgreSQL and the Neon websocket proxy (wsproxy).
#
# - PostgreSQL provides the database.
# - wsproxy bridges the Neon serverless driver's WebSocket protocol to the local
#   Postgres TCP port, so app code that uses `@prisma/adapter-neon` works
#   unchanged against a local DB.
#
# Safe to run repeatedly; it reconciles existing state instead of duplicating it.
set -euo pipefail

PG_MAJOR="${PG_MAJOR:-16}"
DB_NAME="${DB_NAME:-bizzflow}"
DB_USER="${DB_USER:-bizzflow}"
DB_PASS="${DB_PASS:-bizzflow}"
WSPROXY_BIN="${WSPROXY_BIN:-/usr/local/bin/wsproxy}"
WSPROXY_PORT="${WSPROXY_PORT:-5433}"
LOG_DIR="${LOG_DIR:-/tmp/cursor-dev}"
mkdir -p "$LOG_DIR"

echo "[dev-services] ensuring PostgreSQL $PG_MAJOR is running..."
if ! sudo pg_ctlcluster "$PG_MAJOR" main status >/dev/null 2>&1; then
  sudo pg_ctlcluster "$PG_MAJOR" main start || sudo pg_ctlcluster "$PG_MAJOR" main restart
fi

echo "[dev-services] ensuring role/database '$DB_USER'/'$DB_NAME' exist..."
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
ALTER ROLE ${DB_USER} CREATEDB;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null

echo "[dev-services] ensuring wsproxy is running on :$WSPROXY_PORT..."
if ! pgrep -f "$WSPROXY_BIN" >/dev/null 2>&1; then
  # Allow the proxy to reach the local Postgres only.
  LISTEN_PORT=":${WSPROXY_PORT}" \
  ALLOW_ADDR_REGEX='^(127\.0\.0\.1|localhost):5432$' \
  PROMETHEUS_BIND=":2112" \
    nohup "$WSPROXY_BIN" >"$LOG_DIR/wsproxy.log" 2>&1 &
  sleep 1
fi

echo "[dev-services] ready."
echo "  Postgres : 127.0.0.1:5432 (db=$DB_NAME user=$DB_USER)"
echo "  wsproxy  : 127.0.0.1:$WSPROXY_PORT -> 127.0.0.1:5432"
