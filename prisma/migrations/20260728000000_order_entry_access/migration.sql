-- Grant per-user access to the Order Entry feature (admin-controlled).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "order_entry_enabled" BOOLEAN NOT NULL DEFAULT false;
