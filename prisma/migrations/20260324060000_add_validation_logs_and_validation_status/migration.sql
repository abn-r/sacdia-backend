-- CreateTable: validation_logs
CREATE TABLE "validation_logs" (
    "validation_log_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "performed_by" UUID NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_logs_pkey" PRIMARY KEY ("validation_log_id")
);

-- CreateIndex
CREATE INDEX "validation_logs_entity_type_entity_id_idx" ON "validation_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "validation_logs_user_id_idx" ON "validation_logs"("user_id");

-- AddForeignKey
ALTER TABLE "validation_logs" ADD CONSTRAINT "validation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "validation_logs" ADD CONSTRAINT "validation_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AlterTable: Add validation_status to users_honors
ALTER TABLE "users_honors" ADD COLUMN "validation_status" VARCHAR(20) NOT NULL DEFAULT 'in_progress';
