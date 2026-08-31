-- The people audit trail: who did what to whom, append-only.
--
-- Deliberately NO foreign keys: purging a user or an order must not destroy
-- the record that says who purged it. Referential neatness is worth less here
-- than the trail surviving its subjects.
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_user" TEXT,
    "target_order" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");
