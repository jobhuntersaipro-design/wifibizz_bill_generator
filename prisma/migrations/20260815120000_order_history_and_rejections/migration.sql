-- Short human reference (ORD-0042) for every order, assigned at creation.
-- A Postgres sequence rather than a count(*): two agents creating drafts at the
-- same moment must not be handed the same number.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reference" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "orders_reference_key" ON "orders"("reference");
CREATE SEQUENCE IF NOT EXISTS order_reference_seq START 1;

-- Which submit run an event belongs to.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0;

-- Backfill references for existing rows, oldest first so the numbering matches
-- the order they were created in.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM "orders" WHERE "reference" IS NULL ORDER BY "created_at" ASC LOOP
    UPDATE "orders"
       SET "reference" = 'ORD-' || LPAD(nextval('order_reference_seq')::text, 4, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- Append-only status history.
CREATE TABLE IF NOT EXISTS "order_status_events" (
  "id"         TEXT NOT NULL,
  "order_id"   TEXT NOT NULL,
  "attempt"    INTEGER NOT NULL DEFAULT 1,
  "stage"      TEXT,
  "status"     TEXT NOT NULL,
  "message"    TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_status_events_order_id_created_at_idx"
  ON "order_status_events"("order_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "order_status_events"
    ADD CONSTRAINT "order_status_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Device+package combinations the portal has refused.
CREATE TABLE IF NOT EXISTS "device_rejections" (
  "id"          TEXT NOT NULL,
  "device_code" TEXT NOT NULL,
  "device_name" TEXT,
  "offer_name"  TEXT NOT NULL,
  "message"     TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_rejections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "device_rejections_device_code_offer_name_key"
  ON "device_rejections"("device_code", "offer_name");
CREATE INDEX IF NOT EXISTS "device_rejections_offer_name_idx"
  ON "device_rejections"("offer_name");
