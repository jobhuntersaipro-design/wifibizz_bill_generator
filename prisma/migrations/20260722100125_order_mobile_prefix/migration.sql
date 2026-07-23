-- Handphone split into country code + number (matches portal mobileAreaCode/mobilePhone).
ALTER TABLE "orders" ADD COLUMN "mobile_prefix" TEXT DEFAULT '60';
