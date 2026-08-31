-- Self-service password reset.
--
-- The token itself never touches this table: token_hash is SHA-256 of the
-- random value mailed out, so a database leak cannot hand out live reset
-- links. Single-use via used_at, claimed conditionally.
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
