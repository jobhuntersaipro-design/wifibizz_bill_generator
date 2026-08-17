-- The selectable rows inside an offer group: devices the agent picks, and
-- discounts the order carries automatically.
CREATE TABLE IF NOT EXISTS "plan_offer_items" (
  "id"         TEXT NOT NULL,
  "group_id"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "code"       TEXT,
  "monthly"    DOUBLE PRECISION,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "plan_offer_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_offer_items_group_id_name_key"
  ON "plan_offer_items"("group_id", "name");
DO $$ BEGIN
  ALTER TABLE "plan_offer_items"
    ADD CONSTRAINT "plan_offer_items_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "plan_offer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
