-- AlterTable - Add Google Sheet ID to wifibizz_users
ALTER TABLE "wifibizz_users" ADD COLUMN IF NOT EXISTS "google_sheet_id" TEXT;

-- AlterTable - Add synced_to_sheet_at to wifibizz_cases
ALTER TABLE "wifibizz_cases" ADD COLUMN IF NOT EXISTS "synced_to_sheet_at" TIMESTAMP(3);
