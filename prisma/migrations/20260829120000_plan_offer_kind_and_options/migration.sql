-- Offer groups gain an explicit kind, set by an admin on the Plan Details page.
--
-- 'discount' is backfilled from the name, which is exactly the rule
-- isDiscountGroupName() derived at runtime until now — so this deploy changes
-- no behaviour. 'channel' (the Netflix / Max OTT groups) is not guessable from
-- a name we have only seen once, so those are re-tagged by hand afterwards.
ALTER TABLE "plan_offer_groups"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'device';

UPDATE "plan_offer_groups" SET "kind" = 'discount' WHERE "name" ILIKE '%discount%';

-- The third level: "Netflix Basic (Unifi)" is an ordinary item, and its tiers
-- (Basic / Standard / Premium) are its children. `included` marks the one the
-- portal auto-ticks — inferring it from monthly = 0 would be wrong the first
-- time a bundle includes a paid tier.
ALTER TABLE "plan_offer_items"
  ADD COLUMN "parent_id" TEXT,
  ADD COLUMN "included" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "plan_offer_items"
  ADD CONSTRAINT "plan_offer_items_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "plan_offer_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "plan_offer_items_parent_id_idx" ON "plan_offer_items"("parent_id");
