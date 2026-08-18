-- Global settings singleton. Hand-authored: `prisma migrate dev` fails in this
-- repo (its shadow database trips on a pre-existing unrelated migration), so
-- this is applied with `prisma migrate deploy` — the same route the
-- dealer_registered_email migration took.
CREATE TABLE IF NOT EXISTS "app_settings" (
  "id"                      SERIAL PRIMARY KEY,
  "appointment_strategy"    VARCHAR(20) NOT NULL DEFAULT 'first_available',
  "appointment_lead_hours"  INTEGER     NOT NULL DEFAULT 12,
  "appointment_fixed_date"  DATE,
  "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_by"              VARCHAR(255)
);

-- The singleton row. Seeded so a read never has to cope with "no policy" —
-- reading defaults out of an absent row is how a policy silently becomes
-- whatever the reader happened to hard-code.
INSERT INTO "app_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
