-- Address selected from the portal's QryNIGAddress search.
ALTER TABLE "orders" ADD COLUMN "address_id" TEXT;          -- resourceInstId (select By Address Id)
ALTER TABLE "orders" ADD COLUMN "address_full" TEXT;        -- concatAddress
ALTER TABLE "orders" ADD COLUMN "service_category" TEXT;    -- addrServiceCategory (FTTH)
