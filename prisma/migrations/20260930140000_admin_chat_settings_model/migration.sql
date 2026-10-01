-- The admin assistant's model and effort, chosen on /admin/assistant.
-- Additive, nullable: NULL keeps the deployment's ADMIN_CHAT_MODEL / ADMIN_CHAT_EFFORT.
ALTER TABLE "admin_chat_settings" ADD COLUMN "model" TEXT,
ADD COLUMN "effort" TEXT;
