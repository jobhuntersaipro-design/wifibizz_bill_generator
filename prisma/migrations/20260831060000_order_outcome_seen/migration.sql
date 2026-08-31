-- An unseen outcome: a terminal order no signed-in eye has seen yet.
-- NULL on a terminal (submitted/failed/warning) order = unseen.
ALTER TABLE "orders" ADD COLUMN "outcome_seen_at" TIMESTAMP(3);

-- Backfill: every EXISTING terminal order is seen. Without this, deploy day
-- hands every agent a badge counting their entire history — a wall of "unseen"
-- that teaches them to ignore the badge in its first minute. Drafts and
-- in-flight orders stay NULL, which is correct: they have no outcome yet.
UPDATE "orders"
SET "outcome_seen_at" = "updated_at"
WHERE "status" IN ('submitted', 'failed', 'warning', 'order_entered', 'cancelled');
