-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "ai_reason" TEXT,
ADD COLUMN     "classified_at" TIMESTAMP(3),
ADD COLUMN     "folder_by" TEXT,
ADD COLUMN     "folder_id" TEXT,
ADD COLUMN     "last_inbound_at" TIMESTAMP(3),
ADD COLUMN     "last_message_at" TIMESTAMP(3),
ADD COLUMN     "last_preview" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "stage_by" TEXT,
ADD COLUMN     "stage_id" TEXT,
ADD COLUMN     "tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tags_by" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "message_id" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "from_me" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "media" JSONB,
    "status" TEXT,
    "error" TEXT,
    "source" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "whatsapp_labels" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'gray',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_messages_wa_id_sent_at_idx" ON "whatsapp_messages"("wa_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_labels_kind_name_key" ON "whatsapp_labels"("kind", "name");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_last_message_at_idx" ON "whatsapp_conversations"("last_message_at");


-- Seed lists. All editable on /admin/whatsapp → Settings.
INSERT INTO "whatsapp_labels" ("id", "kind", "name", "description", "color", "sort") VALUES
  ('seed_stage_new', 'stage', 'New', 'First contact. The customer has not said what they want yet.', 'gray', 0),
  ('seed_stage_interested', 'stage', 'Interested', 'Asked about a plan, price, speed or coverage.', 'blue', 1),
  ('seed_stage_docs', 'stage', 'Docs pending', 'Agreed to sign up; we are waiting for IC, address or other documents.', 'amber', 2),
  ('seed_stage_submitted', 'stage', 'Order submitted', 'Documents received and the order has been placed.', 'violet', 3),
  ('seed_stage_installed', 'stage', 'Installed', 'Installation is done or confirmed.', 'green', 4),
  ('seed_stage_lost', 'stage', 'Lost', 'Not interested, chose another provider, or stopped replying after follow-ups.', 'red', 5),
  ('seed_folder_home', 'folder', 'Home Fibre', 'Residential internet for a home.', 'blue', 0),
  ('seed_folder_business', 'folder', 'Business Fibre', 'Internet for a company, shop or office.', 'violet', 1),
  ('seed_folder_support', 'folder', 'Support', 'An existing customer with a problem, complaint or billing question.', 'amber', 2),
  ('seed_tag_price', 'tag', 'Price question', 'Asks how much a plan costs or about promotions.', 'blue', 0),
  ('seed_tag_coverage', 'tag', 'Coverage check', 'Asks whether fibre is available at an address.', 'green', 1),
  ('seed_tag_docs', 'tag', 'Docs sent', 'Has sent IC, documents or photos for the application.', 'violet', 2),
  ('seed_tag_complaint', 'tag', 'Complaint', 'Unhappy, reports a fault, or escalates a problem.', 'red', 3);
