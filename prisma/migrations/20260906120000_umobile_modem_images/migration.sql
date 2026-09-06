-- Shared UMobile modem image pool. Bytes stay in R2; this table is the index
-- the admin tab lists and the internet-bill generator picks from.
CREATE TABLE IF NOT EXISTS "umobile_modem_images" (
  "id"           TEXT NOT NULL,
  "r2_key"       TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "umobile_modem_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "umobile_modem_images_r2_key_key"
  ON "umobile_modem_images"("r2_key");
