-- Email notifications + server-side batch submit.
--
-- Hand-authored: `prisma migrate dev` fails in this repo (its shadow database
-- trips on a pre-existing unrelated migration), so this is applied with
-- `prisma migrate deploy` — the same route app_settings and error_code took.

-- Where this user's submit-result and batch-summary emails go. Nullable with no
-- backfill on purpose: a NULL means "use my login email", resolved at send time.
-- Copying `email` in here instead would freeze today's address and silently keep
-- mailing it after the login address changes.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notification_email" TEXT;

-- Exactly-once guard for the single-submit result email. NULL = not yet sent;
-- the webhook claims it with UPDATE ... WHERE notified_at IS NULL before
-- sending, so a retried delivery cannot send a second copy.
--
-- Existing terminal orders stay NULL and are never mailed about: nothing polls
-- them again, so there is no send path for a row that finished before this
-- feature existed.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "notified_at" TIMESTAMP(3);

-- One server-side batch submit.
CREATE TABLE IF NOT EXISTS "batch_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    -- Ordered array of Order.id, oldest-created first — the run order the
    -- droplet was given and preserves.
    "order_ids" JSONB NOT NULL,
    -- Per-order outcomes, denormalised so the summary describes the run as it
    -- happened even if an order is edited or deleted afterwards.
    "results" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "scraper_batch_id" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "batch_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "batch_runs_user_id_status_idx" ON "batch_runs"("user_id", "status");

-- Cascade: a deleted user's batch history has no meaning on its own, and
-- `orders` already cascades the same way.
DO $$
BEGIN
    ALTER TABLE "batch_runs"
      ADD CONSTRAINT "batch_runs_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
