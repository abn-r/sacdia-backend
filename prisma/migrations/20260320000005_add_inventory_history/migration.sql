-- CreateTable
CREATE TABLE "inventory_history" (
    "history_id" SERIAL NOT NULL,
    "inventory_id" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "field_changed" VARCHAR(100),
    "old_value" TEXT,
    "new_value" TEXT,
    "performed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateIndex
CREATE INDEX "idx_inventory_history_inventory" ON "inventory_history"("inventory_id");

-- CreateIndex
CREATE INDEX "idx_inventory_history_performer" ON "inventory_history"("performed_by");

-- AddForeignKey
ALTER TABLE "inventory_history" ADD CONSTRAINT "inventory_history_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "club_inventory"("club_inventory_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_history" ADD CONSTRAINT "inventory_history_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
