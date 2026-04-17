-- CreateTable
CREATE TABLE "resource_categories" (
    "resource_category_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_categories_pkey" PRIMARY KEY ("resource_category_id")
);

-- CreateTable
CREATE TABLE "resources" (
    "resource_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "resource_type" VARCHAR(20) NOT NULL,
    "resource_category_id" INTEGER,
    "club_type_id" INTEGER,
    "scope_level" VARCHAR(20) NOT NULL,
    "scope_id" INTEGER,
    "file_key" VARCHAR(500),
    "file_name" VARCHAR(255),
    "file_size" INTEGER,
    "file_mime_type" VARCHAR(100),
    "content" TEXT,
    "external_url" VARCHAR(1000),
    "uploaded_by" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("resource_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resource_categories_name_key" ON "resource_categories"("name");

-- CreateIndex
CREATE INDEX "idx_resource_categories_active" ON "resource_categories"("active");

-- CreateIndex
CREATE INDEX "idx_resources_active" ON "resources"("active");

-- CreateIndex
CREATE INDEX "idx_resources_scope" ON "resources"("scope_level", "scope_id");

-- CreateIndex
CREATE INDEX "idx_resources_club_type" ON "resources"("club_type_id");

-- CreateIndex
CREATE INDEX "idx_resources_category" ON "resources"("resource_category_id");

-- CreateIndex
CREATE INDEX "idx_resources_type" ON "resources"("resource_type");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_resource_category_id_fkey" FOREIGN KEY ("resource_category_id") REFERENCES "resource_categories"("resource_category_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
