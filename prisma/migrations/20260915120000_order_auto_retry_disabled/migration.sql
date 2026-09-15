-- An order cloned by admin to replicate a failure runs once per Submit: the
-- automatic retry would mint extra real orders at Unifi for a run that exists
-- only to be watched.
ALTER TABLE "orders" ADD COLUMN "auto_retry_disabled" BOOLEAN NOT NULL DEFAULT false;
