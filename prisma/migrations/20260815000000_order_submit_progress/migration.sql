-- Live submit progress for order entry. The scraper already reports a stage key
-- per portal milestone; these columns let the browser poll for it instead of
-- holding a long request open, and let a poll after the submitting tab is gone
-- still reconcile the run — see context/features/order-submit-progress.md.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "job_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stage_at" TIMESTAMP(3);
