-- Admin-curated plans and their portal offer groups.
--
-- Replaces the automatic-discovery tables: reading a package's devices required
-- minting a real order (the Offer dialog only exists on an order's detail page),
-- so an admin records the mandatory group names instead.
CREATE TABLE IF NOT EXISTS "plans" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "category"   TEXT NOT NULL,
  "bandwidth"  TEXT,
  "published"  BOOLEAN NOT NULL DEFAULT false,
  "notes"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plans_name_key" ON "plans"("name");
CREATE INDEX IF NOT EXISTS "plans_category_idx" ON "plans"("category");

CREATE TABLE IF NOT EXISTS "plan_offer_groups" (
  "id"         TEXT NOT NULL,
  "plan_id"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "mandatory"  BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "plan_offer_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_offer_groups_plan_id_name_key"
  ON "plan_offer_groups"("plan_id", "name");
DO $$ BEGIN
  ALTER TABLE "plan_offer_groups"
    ADD CONSTRAINT "plan_offer_groups_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Automatic discovery is gone; admin data is the single source of truth.
DROP TABLE IF EXISTS "package_offers";
DROP TABLE IF EXISTS "device_rejections";
