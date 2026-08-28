-- A plan an admin has removed from the Plan Details page.
--
-- Removal is a flag rather than a DELETE because the page re-seeds every
-- package in DEALER_OFFERS on read: a deleted row would come straight back on
-- the next load. Hidden rows keep their offer groups, so re-showing one in the
-- database restores what was recorded against it.
ALTER TABLE "plans" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
