ALTER TABLE "annual_folders"
  ADD COLUMN "local_camporee_id" INTEGER,
  ADD COLUMN "union_camporee_id" INTEGER,
  ADD COLUMN "requires_union_confirmation" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "annual_folders"
  ADD CONSTRAINT "annual_folders_local_camporee_id_fkey"
    FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "annual_folders"
  ADD CONSTRAINT "annual_folders_union_camporee_id_fkey"
    FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "annual_folders"
  ADD CONSTRAINT "annual_folders_at_most_one_camporee_check"
  CHECK (NOT (local_camporee_id IS NOT NULL AND union_camporee_id IS NOT NULL));

CREATE INDEX "idx_annual_folders_local_camporee" ON "annual_folders"("local_camporee_id");
CREATE INDEX "idx_annual_folders_union_camporee" ON "annual_folders"("union_camporee_id");
