-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "id_type" TEXT NOT NULL,
    "id_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" TEXT,
    "birthday" TEXT,
    "race" TEXT,
    "nationality" TEXT DEFAULT 'Malaysia',
    "mobile" TEXT,
    "email" TEXT,
    "street" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "offer_category" TEXT,
    "offer_name" TEXT,
    "id_doc_front_url" TEXT,
    "id_doc_back_url" TEXT,
    "utility_bill_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "order_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_status_idx" ON "orders"("user_id", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
