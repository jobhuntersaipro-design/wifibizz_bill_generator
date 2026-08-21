-- The installation appointment printed on the order's e-RF, and when we last
-- looked for it.
--
-- Hand-authored: `prisma migrate dev`'s shadow database fails on this project
-- (a pre-existing unrelated migration), so schema changes are written here and
-- applied with `prisma migrate deploy`.
--
-- installation_date is TEXT, not a timestamp: the portal prints a date plus a
-- two-ended arrival window ("2026-08-20 09:30-12:00"). Storing an instant would
-- claim a precision the appointment does not have.
--
-- installation_checked_at exists so "never looked" and "looked, and this order
-- has no appointment" are distinguishable. Without it, an e-RF that prints no
-- appointment line is re-downloaded on every page load, forever.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "installation_date" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "installation_checked_at" TIMESTAMP(3);
