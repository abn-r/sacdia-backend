-- CreateTable
CREATE TABLE "club_enrollments" (
    "club_enrollment_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "club_section_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "address" TEXT,
    "meeting_days" TEXT,
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_enrollments_pkey" PRIMARY KEY ("club_enrollment_id")
);

-- CreateTable
CREATE TABLE "role_slot_limits" (
    "role_slot_limit_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "role_id" UUID NOT NULL,
    "max_per_section" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_slot_limits_pkey" PRIMARY KEY ("role_slot_limit_id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "config_key" TEXT NOT NULL,
    "config_value" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "config_type" TEXT NOT NULL DEFAULT 'string',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("config_key")
);

-- CreateIndex
CREATE INDEX "idx_club_enrollments_club_section" ON "club_enrollments"("club_section_id");

-- CreateIndex
CREATE INDEX "idx_club_enrollments_year" ON "club_enrollments"("ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_enrollments_club_section_id_ecclesiastical_year_id_key" ON "club_enrollments"("club_section_id", "ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_slot_limits_role_id_key" ON "role_slot_limits"("role_id");

-- AddForeignKey
ALTER TABLE "club_enrollments" ADD CONSTRAINT "club_enrollments_club_section_id_fkey" FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_enrollments" ADD CONSTRAINT "club_enrollments_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_enrollments" ADD CONSTRAINT "club_enrollments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_slot_limits" ADD CONSTRAINT "role_slot_limits_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
