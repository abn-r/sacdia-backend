-- CreateTable
CREATE TABLE "folder_templates" (
    "folder_template_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "name" VARCHAR(200) NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folder_templates_pkey" PRIMARY KEY ("folder_template_id")
);

-- CreateTable
CREATE TABLE "folder_template_sections" (
    "section_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "folder_template_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folder_template_sections_pkey" PRIMARY KEY ("section_id")
);

-- CreateTable
CREATE TABLE "annual_folders" (
    "annual_folder_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "club_enrollment_id" UUID NOT NULL,
    "folder_template_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "submitted_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_folders_pkey" PRIMARY KEY ("annual_folder_id")
);

-- CreateTable
CREATE TABLE "annual_folder_evidences" (
    "evidence_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "annual_folder_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_folder_evidences_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateIndex
CREATE INDEX "idx_folder_templates_club_type" ON "folder_templates"("club_type_id");

-- CreateIndex
CREATE INDEX "idx_folder_templates_year" ON "folder_templates"("ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "folder_templates_club_type_id_ecclesiastical_year_id_key" ON "folder_templates"("club_type_id", "ecclesiastical_year_id");

-- CreateIndex
CREATE INDEX "idx_folder_template_sections_template" ON "folder_template_sections"("folder_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "annual_folders_club_enrollment_id_key" ON "annual_folders"("club_enrollment_id");

-- CreateIndex
CREATE INDEX "idx_annual_folders_template" ON "annual_folders"("folder_template_id");

-- CreateIndex
CREATE INDEX "idx_annual_folder_evidences_folder" ON "annual_folder_evidences"("annual_folder_id");

-- CreateIndex
CREATE INDEX "idx_annual_folder_evidences_section" ON "annual_folder_evidences"("section_id");

-- CreateIndex
CREATE INDEX "idx_annual_folder_evidences_uploader" ON "annual_folder_evidences"("uploaded_by");

-- AddForeignKey
ALTER TABLE "folder_templates" ADD CONSTRAINT "folder_templates_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folder_templates" ADD CONSTRAINT "folder_templates_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folder_template_sections" ADD CONSTRAINT "folder_template_sections_folder_template_id_fkey" FOREIGN KEY ("folder_template_id") REFERENCES "folder_templates"("folder_template_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annual_folders" ADD CONSTRAINT "annual_folders_club_enrollment_id_fkey" FOREIGN KEY ("club_enrollment_id") REFERENCES "club_enrollments"("club_enrollment_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annual_folders" ADD CONSTRAINT "annual_folders_folder_template_id_fkey" FOREIGN KEY ("folder_template_id") REFERENCES "folder_templates"("folder_template_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annual_folder_evidences" ADD CONSTRAINT "annual_folder_evidences_annual_folder_id_fkey" FOREIGN KEY ("annual_folder_id") REFERENCES "annual_folders"("annual_folder_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annual_folder_evidences" ADD CONSTRAINT "annual_folder_evidences_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "folder_template_sections"("section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annual_folder_evidences" ADD CONSTRAINT "annual_folder_evidences_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
