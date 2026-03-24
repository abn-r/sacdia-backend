-- CreateTable
CREATE TABLE "club_transfer_requests" (
    "transfer_request_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "from_section_id" INTEGER NOT NULL,
    "to_section_id" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "review_comment" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_transfer_requests_pkey" PRIMARY KEY ("transfer_request_id")
);

-- CreateTable
CREATE TABLE "role_assignment_requests" (
    "request_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "club_section_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE INDEX "idx_transfer_requests_user" ON "club_transfer_requests"("user_id");

-- CreateIndex
CREATE INDEX "idx_transfer_requests_from_section" ON "club_transfer_requests"("from_section_id");

-- CreateIndex
CREATE INDEX "idx_transfer_requests_to_section" ON "club_transfer_requests"("to_section_id");

-- CreateIndex
CREATE INDEX "idx_transfer_requests_status" ON "club_transfer_requests"("status");

-- CreateIndex
CREATE INDEX "idx_assignment_requests_section" ON "role_assignment_requests"("club_section_id");

-- CreateIndex
CREATE INDEX "idx_assignment_requests_user" ON "role_assignment_requests"("user_id");

-- CreateIndex
CREATE INDEX "idx_assignment_requests_role" ON "role_assignment_requests"("role_id");

-- CreateIndex
CREATE INDEX "idx_assignment_requests_status" ON "role_assignment_requests"("status");

-- AddForeignKey
ALTER TABLE "club_transfer_requests" ADD CONSTRAINT "club_transfer_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_transfer_requests" ADD CONSTRAINT "club_transfer_requests_from_section_id_fkey" FOREIGN KEY ("from_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_transfer_requests" ADD CONSTRAINT "club_transfer_requests_to_section_id_fkey" FOREIGN KEY ("to_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_transfer_requests" ADD CONSTRAINT "club_transfer_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_assignment_requests" ADD CONSTRAINT "role_assignment_requests_club_section_id_fkey" FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_assignment_requests" ADD CONSTRAINT "role_assignment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_assignment_requests" ADD CONSTRAINT "role_assignment_requests_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_assignment_requests" ADD CONSTRAINT "role_assignment_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_assignment_requests" ADD CONSTRAINT "role_assignment_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
