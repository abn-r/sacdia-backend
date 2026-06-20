-- Create finance evidence files for income/expense movements.
CREATE TABLE "finance_evidence_files" (
    "finance_evidence_file_id" SERIAL NOT NULL,
    "finance_id" INTEGER NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(50) NOT NULL,
    "file_size" INTEGER,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "finance_evidence_files_pkey" PRIMARY KEY ("finance_evidence_file_id")
);

CREATE INDEX "idx_finance_evidence_files_finance" ON "finance_evidence_files"("finance_id");
CREATE INDEX "idx_finance_evidence_files_uploaded_by" ON "finance_evidence_files"("uploaded_by_id");

ALTER TABLE "finance_evidence_files"
    ADD CONSTRAINT "finance_evidence_files_finance_id_fkey"
    FOREIGN KEY ("finance_id") REFERENCES "finances"("finance_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "finance_evidence_files"
    ADD CONSTRAINT "finance_evidence_files_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
