-- Automatic retry of a failed submit.
--
-- A counter SEPARATE from orders.attempt, which counts every submit including
-- the ones a human started: reusing it would let a draft an agent resubmitted
-- three times by hand arrive with its automatic budget already spent.
--
-- NOT NULL DEFAULT 0 is honest here, unlike the nullable appointment column
-- beside it — every existing row genuinely has had zero automatic retries.
ALTER TABLE "orders" ADD COLUMN "auto_retries" INTEGER NOT NULL DEFAULT 0;

-- A batch member cannot retry while its own batch still holds the droplet's
-- single browser lock, so failed members are re-submitted as a NEW batch once
-- the first one closes. This links the two, so the original batch's summary can
-- say which of its failures are still being retried instead of reporting them
-- as final.
ALTER TABLE "batch_runs" ADD COLUMN "retry_of_batch_id" TEXT;
