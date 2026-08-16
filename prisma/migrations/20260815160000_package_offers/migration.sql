-- The devices a package actually offers, read from the portal's Offer dialog.
-- Our static catalogue lists different offers entirely, which is what caused
-- "the current offer can't be subscribed through Contactless Journey".
CREATE TABLE IF NOT EXISTS "package_offers" (
  "id"         TEXT NOT NULL,
  "offer_name" TEXT NOT NULL,
  "devices"    JSONB NOT NULL,
  "seen_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_offers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "package_offers_offer_name_key"
  ON "package_offers"("offer_name");
