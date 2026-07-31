-- Superadmin flag: can view/manage all users' orders (Order Entry drafts).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "is_super_admin" BOOLEAN NOT NULL DEFAULT false;
