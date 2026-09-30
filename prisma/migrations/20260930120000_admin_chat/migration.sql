-- Admin AI chatbot (testing feature): conversations, turns, and handoffs to a
-- human. Additive only; nothing existing is touched.
CREATE TABLE "admin_chat_conversations" (
    "id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_chat_conversations_client_key_locked_until_idx"
    ON "admin_chat_conversations"("client_key", "locked_until");

CREATE TABLE "admin_chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_chat_messages_conversation_id_created_at_idx"
    ON "admin_chat_messages"("conversation_id", "created_at");
CREATE INDEX "admin_chat_messages_role_created_at_idx"
    ON "admin_chat_messages"("role", "created_at");

ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "admin_chat_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_chat_escalations" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "order_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "admin_chat_escalations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_chat_escalations_status_created_at_idx"
    ON "admin_chat_escalations"("status", "created_at");

ALTER TABLE "admin_chat_escalations" ADD CONSTRAINT "admin_chat_escalations_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "admin_chat_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
