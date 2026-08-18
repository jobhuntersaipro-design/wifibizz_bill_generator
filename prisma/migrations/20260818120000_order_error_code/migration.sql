-- Classified failure code alongside the free-text portal message.
--
-- Hand-authored: `prisma migrate dev` fails in this repo (its shadow database
-- trips on a pre-existing unrelated migration), so this is applied with
-- `prisma migrate deploy` — the same route app_settings took.
--
-- Nullable with no backfill on purpose. Existing rows failed before the scraper
-- classified anything, and inventing a code for them would assert a diagnosis
-- nobody made; the UI treats a null code as "just show the message", which is
-- exactly the old behaviour.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "error_code" VARCHAR(64);
ALTER TABLE "order_status_events" ADD COLUMN IF NOT EXISTS "error_code" VARCHAR(64);
