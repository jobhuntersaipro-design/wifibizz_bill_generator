-- Email registered on the Unifi dealer account, used as the `to:` filter for
-- auto-OTP reads (Gmail forwarding target) — see gmail-otp-auto-read-spec.md.
ALTER TABLE "dealer_accounts" ADD COLUMN IF NOT EXISTS "registered_email" TEXT;
