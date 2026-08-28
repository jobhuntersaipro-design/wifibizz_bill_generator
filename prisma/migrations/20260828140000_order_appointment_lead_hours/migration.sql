-- The appointment lead time moves from one global row to the order itself.
--
-- Nullable on purpose: every draft written before this column existed has no
-- lead time, and so does anything scripts/bulk_create_order writes. A DEFAULT
-- would claim the agent chose it. Null resolves to DEFAULT_LEAD_HOURS at
-- payload-build time.
ALTER TABLE "orders" ADD COLUMN "appointment_lead_hours" INTEGER;

-- The global policy is gone with the /admin/settings page that edited it.
DROP TABLE IF EXISTS "app_settings";
