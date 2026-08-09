-- Device / add-on (VAS) fields on orders, chosen for "with device" bundles.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "device_code" VARCHAR(40);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "device_name" VARCHAR(255);
