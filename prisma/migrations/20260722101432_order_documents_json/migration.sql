-- Flexible document list (up to 10 files) replaces the 3 fixed URL columns.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "id_doc_front_url";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "id_doc_back_url";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "utility_bill_url";
ALTER TABLE "orders" ADD COLUMN "documents" JSONB;
