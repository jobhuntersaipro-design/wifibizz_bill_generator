-- Business-case fields for wifibizz_cases.
--
-- company_name / company_reg / id_type come straight off the DataTables list row
-- (the API has always returned them; the crawler simply never read them). Before
-- this, company + BRN were derived at read time by splitting `full_name` on its
-- trailing bracket, which fails for 42% of real business rows because the portal
-- nests the old registration number inside the new one:
--   Goldmate Corporation Sdn Bhd(198401017604 (130158-V))
--
-- director_name is the Customer-tab "Name" and is detail-page only — the list row
-- carries the COMPANY(REG) string in customer_name, never the person.
ALTER TABLE "wifibizz_cases" ADD COLUMN IF NOT EXISTS "company_name"  VARCHAR(255);
ALTER TABLE "wifibizz_cases" ADD COLUMN IF NOT EXISTS "company_reg"   VARCHAR(100);
ALTER TABLE "wifibizz_cases" ADD COLUMN IF NOT EXISTS "id_type"       VARCHAR(50);
ALTER TABLE "wifibizz_cases" ADD COLUMN IF NOT EXISTS "director_name" VARCHAR(255);
