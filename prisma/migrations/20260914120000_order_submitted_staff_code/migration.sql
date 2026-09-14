-- Record which dealer staff code submitted each order, frozen at submit time.
ALTER TABLE "orders" ADD COLUMN "submitted_staff_code" TEXT;

-- Backfill every order that has been submitted at least once (attempt counting
-- post-dates the earliest orders, so a portal number or non-draft status counts). This is the best
-- available answer, not a recorded one: the code the submitting user (or, before
-- last_submit_user_id existed, the owner) is connected as TODAY.
UPDATE "orders" o
SET "submitted_staff_code" = d."staff_code"
FROM "dealer_accounts" d
WHERE (o."attempt" > 0 OR o."order_id" IS NOT NULL OR o."status" <> 'draft')
  AND o."submitted_staff_code" IS NULL
  AND d."user_id" = COALESCE(o."last_submit_user_id", o."user_id")
  AND NULLIF(TRIM(d."staff_code"), '') IS NOT NULL;

CREATE INDEX "orders_submitted_staff_code_idx" ON "orders"("submitted_staff_code");
