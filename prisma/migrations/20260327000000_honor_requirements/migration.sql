-- CreateTable
CREATE TABLE "honor_requirements" (
    "requirement_id" SERIAL NOT NULL,
    "honor_id" INTEGER NOT NULL,
    "requirement_number" INTEGER NOT NULL,
    "requirement_text" TEXT NOT NULL,
    "has_sub_items" BOOLEAN NOT NULL DEFAULT false,
    "needs_review" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "honor_requirements_pkey" PRIMARY KEY ("requirement_id")
);

-- CreateTable
CREATE TABLE "user_honor_requirement_progress" (
    "progress_id" SERIAL NOT NULL,
    "user_honor_id" INTEGER NOT NULL,
    "requirement_id" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_honor_requirement_progress_pkey" PRIMARY KEY ("progress_id")
);

-- CreateIndex
CREATE INDEX "honor_requirements_honor_id_idx" ON "honor_requirements"("honor_id");

-- CreateIndex
CREATE UNIQUE INDEX "honor_requirements_honor_id_requirement_number_key" ON "honor_requirements"("honor_id", "requirement_number");

-- CreateIndex
CREATE INDEX "user_honor_requirement_progress_user_honor_id_idx" ON "user_honor_requirement_progress"("user_honor_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_honor_requirement_progress_user_honor_id_requirement_id_key" ON "user_honor_requirement_progress"("user_honor_id", "requirement_id");

-- AddForeignKey
ALTER TABLE "honor_requirements" ADD CONSTRAINT "honor_requirements_honor_id_fkey" FOREIGN KEY ("honor_id") REFERENCES "honors"("honor_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_honor_requirement_progress" ADD CONSTRAINT "user_honor_requirement_progress_user_honor_id_fkey" FOREIGN KEY ("user_honor_id") REFERENCES "users_honors"("user_honor_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_honor_requirement_progress" ADD CONSTRAINT "user_honor_requirement_progress_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "honor_requirements"("requirement_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
