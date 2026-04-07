-- Rename bill_limit back to case_limit
ALTER TABLE "User" RENAME COLUMN "bill_limit" TO "case_limit";

-- Create case_usage_log table
CREATE TABLE "case_usage_log" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "case_no" VARCHAR(20) NOT NULL,
    "case_name" VARCHAR(255),
    "bill_type" VARCHAR(20) NOT NULL,
    "charged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_usage_log_pkey" PRIMARY KEY ("id")
);

-- Create case_limit_change_log table
CREATE TABLE "case_limit_change_log" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "previous_limit" INTEGER NOT NULL,
    "new_limit" INTEGER NOT NULL,
    "changed_by" VARCHAR(100) NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_limit_change_log_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "case_usage_log_user_id_idx" ON "case_usage_log"("user_id");
CREATE INDEX "case_usage_log_charged_at_idx" ON "case_usage_log"("charged_at");
CREATE INDEX "case_limit_change_log_user_id_idx" ON "case_limit_change_log"("user_id");

-- Add foreign keys
ALTER TABLE "case_usage_log" ADD CONSTRAINT "case_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_limit_change_log" ADD CONSTRAINT "case_limit_change_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill case_usage_log from existing billed cases
INSERT INTO case_usage_log (user_id, case_no, case_name, bill_type, charged_at)
SELECT wu.user_id_ref, wc.case_no, wc.full_name,
  CASE WHEN wc.internet_bill_url IS NOT NULL THEN 'internet' ELSE 'utility' END,
  COALESCE(wc.updated_at, NOW())
FROM wifibizz_cases wc
JOIN wifibizz_users wu ON wu.id = wc.user_id
WHERE wu.user_id_ref IS NOT NULL
  AND (wc.internet_bill_url IS NOT NULL OR wc.utility_bill_url IS NOT NULL);
