-- Soft delete for orders.
--
-- Deleting used to destroy the row and, through the cascade on
-- order_status_events, its entire history. That made "admin can see deleted
-- orders" impossible, so deletion becomes a flag instead.
--
-- Nullable with no default and no backfill: every existing row is, correctly,
-- not deleted. A DEFAULT here would be meaningless and a backfill would be a
-- lie about rows nobody deleted.
ALTER TABLE "orders" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Every agent-facing query now filters on this, so it is the most-read
-- predicate in the app.
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- The admin aggregations group terminal events by day. The only index on this
-- table is (order_id, created_at), which none of those queries can use.
--
-- It matters more than the row count suggests: the table grows ~35x faster than
-- orders do, because a single submit emits a per-stage `submitting` event for
-- every portal milestone (measured: 4 orders -> 140 events, 134 of them
-- `submitting`).
CREATE INDEX "order_status_events_status_created_at_idx" ON "order_status_events"("status", "created_at");
