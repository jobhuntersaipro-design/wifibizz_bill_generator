-- The admin assistant's editable prompt and tool settings (one row, id 1).
-- Additive only. No row means the built-in defaults, so nothing changes until
-- an admin saves on /admin/assistant.
CREATE TABLE "admin_chat_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "instructions" TEXT,
    "disabled_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tool_descriptions" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_chat_settings_pkey" PRIMARY KEY ("id")
);
