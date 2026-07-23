ALTER TABLE "orders" ADD COLUMN "country" TEXT DEFAULT 'Malaysia';
UPDATE "orders" SET "country" = 'Malaysia' WHERE "country" IS NULL;
