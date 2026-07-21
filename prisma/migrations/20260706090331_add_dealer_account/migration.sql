-- CreateTable
CREATE TABLE "dealer_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "staff_code" TEXT NOT NULL,
    "last_connected_at" TIMESTAMP(3),
    "session_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dealer_accounts_user_id_key" ON "dealer_accounts"("user_id");

-- AddForeignKey
ALTER TABLE "dealer_accounts" ADD CONSTRAINT "dealer_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
