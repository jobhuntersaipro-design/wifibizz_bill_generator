-- Whose dealer session ran the last submit.
--
-- A submit runs under the portal session of whoever pressed the button, not the
-- draft's owner: `startSubmit` sends `user_key: session.user.id`, and a
-- superadmin submitting another agent's draft does so under their OWN session
-- (order.ts:766-767). An automatic retry has no session to read, and keying it
-- on `orders.user_id` would run it as an agent who may have no dealer session at
-- all — so the submit records which session it used, and the retry reuses that.
--
-- Nullable: rows that predate this were submitted before any retry existed, and
-- the retry falls back to `user_id` rather than refusing to run.
ALTER TABLE "orders" ADD COLUMN "last_submit_user_id" TEXT;

-- Deferred retries: set when a retry was decided but the droplet was busy with
-- another job (its HTTP 409 lock), cleared when the retry actually starts.
-- Vercel cannot sleep between requests, so "try again shortly" has to be a row
-- somebody sweeps, not a timer held in memory.
ALTER TABLE "orders" ADD COLUMN "auto_retry_at" TIMESTAMP(3);

-- The overwhelming majority of rows owe nothing, and must not sit in the index.
CREATE INDEX "orders_auto_retry_at_idx" ON "orders"("auto_retry_at")
  WHERE "auto_retry_at" IS NOT NULL;
