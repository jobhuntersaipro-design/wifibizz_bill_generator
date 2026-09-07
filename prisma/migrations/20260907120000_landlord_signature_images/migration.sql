-- Shared landlord signature image pool. Bytes stay in R2; this table is the
-- index the admin tab lists and TA / Authorization Letter generation picks from.
-- An empty pool is valid: generate still succeeds with a blank signature line.
CREATE TABLE IF NOT EXISTS "landlord_signature_images" (
  "id"           TEXT NOT NULL,
  "r2_key"       TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "landlord_signature_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "landlord_signature_images_r2_key_key"
  ON "landlord_signature_images"("r2_key");
