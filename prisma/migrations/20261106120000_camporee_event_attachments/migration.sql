-- CreateTable
CREATE TABLE "camporee_event_attachments" (
    "camporee_event_attachment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "camporee_event_id" INTEGER NOT NULL,
    "file_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_event_attachments_pkey" PRIMARY KEY ("camporee_event_attachment_id")
);

-- CreateIndex
CREATE INDEX "idx_camporee_event_attachments_event" ON "camporee_event_attachments"("camporee_event_id", "active", "display_order");

-- AddForeignKey
ALTER TABLE "camporee_event_attachments" ADD CONSTRAINT "camporee_event_attachments_camporee_event_id_fkey" FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "camporee_event_attachments" ADD CONSTRAINT "camporee_event_attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;
