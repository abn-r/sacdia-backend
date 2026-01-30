-- CreateEnum
CREATE TYPE "blood_type" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('Masculino', 'Femenino');

-- CreateEnum
CREATE TYPE "role_category" AS ENUM ('GLOBAL', 'CLUB');

-- CreateEnum
CREATE TYPE "investiture_status_enum" AS ENUM ('IN_PROGRESS', 'SUBMITTED_FOR_VALIDATION', 'APPROVED', 'REJECTED', 'INVESTIDO');

-- CreateEnum
CREATE TYPE "investiture_action_enum" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REINVESTITURE_REQUESTED');

-- CreateEnum
CREATE TYPE "insurance_type_enum" AS ENUM ('GENERAL_ACTIVITIES', 'CAMPOREE', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "evidence_validation_enum" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED');

-- CreateTable
CREATE TABLE "activities" (
    "activity_id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "club_type_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION NOT NULL,
    "long" DOUBLE PRECISION NOT NULL,
    "activity_time" VARCHAR(10) NOT NULL DEFAULT '09:00',
    "activity_place" TEXT NOT NULL DEFAULT 'place',
    "image" TEXT NOT NULL,
    "platform" INTEGER NOT NULL DEFAULT 0,
    "activity_type" INTEGER NOT NULL DEFAULT 0,
    "link_meet" TEXT,
    "additional_data" TEXT,
    "attendees" JSON,
    "classes" JSON,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6),
    "modified_at" TIMESTAMPTZ(6),
    "club_adv_id" INTEGER NOT NULL,
    "club_mg_id" INTEGER NOT NULL,
    "club_pathf_id" INTEGER NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("activity_id")
);

-- CreateTable
CREATE TABLE "assignments_folders" (
    "assignment_folder_id" SERIAL NOT NULL,
    "folder_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignment_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,

    CONSTRAINT "assignments_folders_pkey" PRIMARY KEY ("assignment_folder_id")
);

-- CreateTable
CREATE TABLE "attending_clubs_camporees" (
    "attending_clubs_id" SERIAL NOT NULL,
    "camporee_id" INTEGER NOT NULL,
    "camporee_type" VARCHAR(50) NOT NULL,
    "club_id" INTEGER,
    "local_field_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,

    CONSTRAINT "attending_clubs_camporees_pkey" PRIMARY KEY ("attending_clubs_id")
);

-- CreateTable
CREATE TABLE "attending_members_camporees" (
    "attending_members_id" SERIAL NOT NULL,
    "camporee_id" INTEGER NOT NULL,
    "camporee_type" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "club_name" VARCHAR(255),
    "local_field_id" INTEGER,
    "insurance_verified" BOOLEAN NOT NULL DEFAULT false,
    "insurance_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attending_members_camporees_pkey" PRIMARY KEY ("attending_members_id")
);

-- CreateTable
CREATE TABLE "churches" (
    "church_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "district_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "churches_pkey" PRIMARY KEY ("church_id")
);

-- CreateTable
CREATE TABLE "class_module_progress" (
    "module_progress_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" INTEGER NOT NULL,
    "module_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_module_progress_pkey" PRIMARY KEY ("module_progress_id")
);

-- CreateTable
CREATE TABLE "class_modules" (
    "module_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "class_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_modules_pkey" PRIMARY KEY ("module_id")
);

-- CreateTable
CREATE TABLE "class_section_progress" (
    "section_progress_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" INTEGER NOT NULL,
    "module_id" INTEGER NOT NULL,
    "section_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "evidences" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_section_progress_pkey" PRIMARY KEY ("section_progress_id")
);

-- CreateTable
CREATE TABLE "class_sections" (
    "section_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "module_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sections_pkey" PRIMARY KEY ("section_id")
);

-- CreateTable
CREATE TABLE "classes" (
    "class_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "minimum_age" INTEGER NOT NULL,
    "requires_invested_gm" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "material_url" VARCHAR,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("class_id")
);

-- CreateTable
CREATE TABLE "club_ideals" (
    "club_ideal_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "ideal_order" INTEGER NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "ideal" TEXT,

    CONSTRAINT "club_ideals_pkey" PRIMARY KEY ("club_ideal_id")
);

-- CreateTable
CREATE TABLE "club_inventory" (
    "club_inventory_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "inventory_category_id" INTEGER,
    "amount" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,

    CONSTRAINT "club_inventory_pkey" PRIMARY KEY ("club_inventory_id")
);

-- CreateTable
CREATE TABLE "club_types" (
    "ct_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_types_pkey" PRIMARY KEY ("ct_id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "club_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "local_field_id" INTEGER NOT NULL,
    "address" TEXT,
    "district_id" INTEGER NOT NULL,
    "church_id" INTEGER NOT NULL,
    "coordinates" JSON NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("club_id")
);

-- CreateTable
CREATE TABLE "club_adventurers" (
    "club_adv_id" SERIAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "souls_target" INTEGER NOT NULL DEFAULT 1,
    "fee" INTEGER NOT NULL DEFAULT 1,
    "meeting_day" JSON[],
    "meeting_time" JSON[],
    "club_type_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "main_club_id" INTEGER,

    CONSTRAINT "club_adventurers_pkey" PRIMARY KEY ("club_adv_id")
);

-- CreateTable
CREATE TABLE "club_pathfinders" (
    "club_pathf_id" SERIAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "souls_target" INTEGER NOT NULL DEFAULT 1,
    "fee" INTEGER NOT NULL DEFAULT 1,
    "meeting_day" JSON[],
    "meeting_time" JSON[],
    "club_type_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "main_club_id" INTEGER,

    CONSTRAINT "club_pathfinders_pkey" PRIMARY KEY ("club_pathf_id")
);

-- CreateTable
CREATE TABLE "club_master_guild" (
    "club_mg_id" SERIAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "souls_target" INTEGER NOT NULL DEFAULT 1,
    "fee" INTEGER NOT NULL DEFAULT 1,
    "meeting_day" JSON[],
    "meeting_time" JSON[],
    "club_type_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "main_club_id" INTEGER,

    CONSTRAINT "club_master_guild_pkey" PRIMARY KEY ("club_mg_id")
);

-- CreateTable
CREATE TABLE "club_role_assignments" (
    "assignment_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "club_adv_id" INTEGER,
    "club_pathf_id" INTEGER,
    "club_mg_id" INTEGER,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_role_assignments_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "countries" (
    "country_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "abbreviation" VARCHAR(8) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("country_id")
);

-- CreateTable
CREATE TABLE "districts" (
    "district_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "local_field_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("district_id")
);

-- CreateTable
CREATE TABLE "ecclesiastical_year" (
    "year_id" SERIAL NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecclesiastical_year_pkey" PRIMARY KEY ("year_id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "enrollment_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "enrollment_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "investiture_status" "investiture_status_enum" NOT NULL DEFAULT 'IN_PROGRESS',
    "submitted_for_validation" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(6),
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "investiture_date" TIMESTAMPTZ(6),
    "advanced_status" BOOLEAN DEFAULT false,
    "locked_for_validation" BOOLEAN NOT NULL DEFAULT false,
    "cross_type_enrollment" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "log_id" SERIAL NOT NULL,
    "procedure_name" VARCHAR(100) NOT NULL,
    "error_message" TEXT NOT NULL,
    "additional_details" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "finances" (
    "finance_id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "club_type_id" INTEGER NOT NULL,
    "finance_category_id" INTEGER NOT NULL,
    "finance_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,

    CONSTRAINT "finances_pkey" PRIMARY KEY ("finance_id")
);

-- CreateTable
CREATE TABLE "finances_categories" (
    "finance_category_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon" INTEGER DEFAULT 0,
    "type" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finances_categories_pkey" PRIMARY KEY ("finance_category_id")
);

-- CreateTable
CREATE TABLE "folders" (
    "folder_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "club_type" INTEGER,
    "ecclesiastical_year_id" INTEGER,
    "status" VARCHAR(50) DEFAULT 'incompleto',
    "total_points" INTEGER DEFAULT 0,
    "max_points" INTEGER DEFAULT 0,
    "minimum_points" INTEGER DEFAULT 0,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("folder_id")
);

-- CreateTable
CREATE TABLE "folders_modules" (
    "folder_module_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "folder_id" INTEGER,
    "total_points" INTEGER DEFAULT 0,
    "max_points" INTEGER DEFAULT 0,
    "minimum_points" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folders_modules_pkey" PRIMARY KEY ("folder_module_id")
);

-- CreateTable
CREATE TABLE "folders_modules_records" (
    "folder_module_record_id" SERIAL NOT NULL,
    "folder_id" INTEGER,
    "module_id" INTEGER,
    "points" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "folders_modules_records_pkey" PRIMARY KEY ("folder_module_record_id")
);

-- CreateTable
CREATE TABLE "folders_section_records" (
    "folder_section_record_id" SERIAL NOT NULL,
    "folder_id" INTEGER,
    "module_id" INTEGER,
    "section_id" INTEGER,
    "points" INTEGER DEFAULT 0,
    "pdf_file" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,
    "evidences" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "folders_section_records_pkey" PRIMARY KEY ("folder_section_record_id")
);

-- CreateTable
CREATE TABLE "folders_sections" (
    "folder_section_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "module_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "total_points" INTEGER DEFAULT 0,
    "max_points" INTEGER DEFAULT 0,
    "minimum_points" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "folders_sections_pkey" PRIMARY KEY ("folder_section_id")
);

-- CreateTable
CREATE TABLE "honors" (
    "honor_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "honor_image" TEXT NOT NULL,
    "honors_category_id" INTEGER NOT NULL,
    "master_honors_id" INTEGER,
    "material_url" VARCHAR NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "approval" INTEGER NOT NULL DEFAULT 1,
    "skill_level" INTEGER NOT NULL DEFAULT 1,
    "year" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "honors_pkey" PRIMARY KEY ("honor_id")
);

-- CreateTable
CREATE TABLE "honors_categories" (
    "honor_category_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "honors_categories_pkey" PRIMARY KEY ("honor_category_id")
);

-- CreateTable
CREATE TABLE "inventory_categories" (
    "inventory_categoty_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "icon" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("inventory_categoty_id")
);

-- CreateTable
CREATE TABLE "local_camporees" (
    "local_camporee_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "includes_adventurers" BOOLEAN DEFAULT false,
    "includes_pathfinders" BOOLEAN DEFAULT false,
    "includes_master_guides" BOOLEAN DEFAULT false,
    "local_camporee_place" TEXT NOT NULL DEFAULT 'Lugar',
    "registration_cost" DECIMAL(10,2),
    "ecclesiastical_year" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_camporees_pkey" PRIMARY KEY ("local_camporee_id")
);

-- CreateTable
CREATE TABLE "local_fields" (
    "local_field_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "abbreviation" VARCHAR(8) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "union_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_fields_pkey" PRIMARY KEY ("local_field_id")
);

-- CreateTable
CREATE TABLE "master_honors" (
    "master_honor_id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "master_image" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_honors_pkey" PRIMARY KEY ("master_honor_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "permission_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_permission_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_permission_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "role_name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role_category" "role_category" NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "union_camporee_local_fields" (
    "union_camporee_lf_id" INTEGER NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "union_camporee_local_fields_pkey" PRIMARY KEY ("union_camporee_lf_id","local_field_id")
);

-- CreateTable
CREATE TABLE "union_camporees" (
    "union_camporee_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "union_id" INTEGER NOT NULL,
    "includes_adventurers" BOOLEAN DEFAULT false,
    "includes_pathfinders" BOOLEAN DEFAULT false,
    "includes_master_guides" BOOLEAN DEFAULT false,
    "union_camporee_place" TEXT NOT NULL DEFAULT 'Lugar',
    "registration_cost" DECIMAL(10,2),
    "ecclesiastical_year" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "union_camporees_pkey" PRIMARY KEY ("union_camporee_id")
);

-- CreateTable
CREATE TABLE "unions" (
    "union_id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "abbreviation" VARCHAR(8) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "country_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unions_pkey" PRIMARY KEY ("union_id")
);

-- CreateTable
CREATE TABLE "unit_members" (
    "unit_member_id" SERIAL NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unit_members_pkey" PRIMARY KEY ("unit_member_id")
);

-- CreateTable
CREATE TABLE "units" (
    "unit_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "captain_id" UUID NOT NULL,
    "secretary_id" UUID NOT NULL,
    "advisor_id" UUID NOT NULL,
    "substitute_advisor_id" UUID,
    "club_type_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "club_adv_id" INTEGER,
    "club_mg_id" INTEGER,
    "club_pathf_id" INTEGER,

    CONSTRAINT "units_pkey" PRIMARY KEY ("unit_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL DEFAULT auth.uid(),
    "name" VARCHAR(50),
    "paternal_last_name" VARCHAR(50),
    "maternal_last_name" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "email" VARCHAR(100) NOT NULL,
    "gender" VARCHAR,
    "birthday" DATE,
    "blood" "blood_type",
    "baptism" BOOLEAN NOT NULL DEFAULT false,
    "baptism_date" DATE,
    "apple_connected" BOOLEAN NOT NULL DEFAULT false,
    "fb_connected" BOOLEAN NOT NULL DEFAULT false,
    "google_connected" BOOLEAN NOT NULL DEFAULT false,
    "user_image" TEXT,
    "country_id" INTEGER,
    "union_id" INTEGER,
    "access_app" BOOLEAN DEFAULT true,
    "access_panel" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "local_field_id" INTEGER,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "users_pr" (
    "user_pr_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "profile_picture_complete" BOOLEAN NOT NULL DEFAULT false,
    "personal_info_complete" BOOLEAN NOT NULL DEFAULT false,
    "club_selection_complete" BOOLEAN NOT NULL DEFAULT false,
    "date_completed" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pr_pkey" PRIMARY KEY ("user_pr_id")
);

-- CreateTable
CREATE TABLE "users_classes" (
    "user_class_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" INTEGER NOT NULL,
    "investiture" BOOLEAN NOT NULL DEFAULT false,
    "date_investiture" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advanced" BOOLEAN NOT NULL DEFAULT false,
    "certificate" VARCHAR,
    "current_class" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_classes_pkey" PRIMARY KEY ("user_class_id")
);

-- CreateTable
CREATE TABLE "certifications" (
    "certification_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "material_url" VARCHAR,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("certification_id")
);

-- CreateTable
CREATE TABLE "certification_modules" (
    "module_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "certification_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certification_modules_pkey" PRIMARY KEY ("module_id")
);

-- CreateTable
CREATE TABLE "certification_sections" (
    "section_id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "module_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certification_sections_pkey" PRIMARY KEY ("section_id")
);

-- CreateTable
CREATE TABLE "users_certifications" (
    "enrollment_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "certification_id" INTEGER NOT NULL,
    "enrollment_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completion_status" BOOLEAN NOT NULL DEFAULT false,
    "completion_date" TIMESTAMPTZ(6),
    "certificate_url" VARCHAR,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_certifications_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "certification_module_progress" (
    "progress_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "certification_id" INTEGER NOT NULL,
    "module_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certification_module_progress_pkey" PRIMARY KEY ("progress_id")
);

-- CreateTable
CREATE TABLE "certification_section_progress" (
    "progress_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "certification_id" INTEGER NOT NULL,
    "module_id" INTEGER NOT NULL,
    "section_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "evidences" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certification_section_progress_pkey" PRIMARY KEY ("progress_id")
);

-- CreateTable
CREATE TABLE "member_insurances" (
    "insurance_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "insurance_type" "insurance_type_enum" NOT NULL,
    "policy_number" VARCHAR(100),
    "provider" VARCHAR(255),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "coverage_amount" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_insurances_pkey" PRIMARY KEY ("insurance_id")
);

-- CreateTable
CREATE TABLE "investiture_validation_history" (
    "history_id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "action" "investiture_action_enum" NOT NULL,
    "performed_by" UUID NOT NULL,
    "comments" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investiture_validation_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateTable
CREATE TABLE "investiture_config" (
    "config_id" SERIAL NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "submission_deadline" DATE NOT NULL,
    "investiture_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investiture_config_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "diseases" (
    "disease_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "diseases_pkey" PRIMARY KEY ("disease_id")
);

-- CreateTable
CREATE TABLE "allergies" (
    "allergy_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("allergy_id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "emergency_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "relationship_type" INTEGER NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID NOT NULL,
    "contact_user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "phone" VARCHAR NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("emergency_id")
);

-- CreateTable
CREATE TABLE "weekly_records" (
    "record_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "week" INTEGER NOT NULL,
    "attendance" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "weekly_records_pkey" PRIMARY KEY ("record_id")
);

-- CreateTable
CREATE TABLE "relationship_type" (
    "relationship_type_id" SERIAL NOT NULL,
    "name" VARCHAR,
    "active" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6),

    CONSTRAINT "relationship_type_pkey" PRIMARY KEY ("relationship_type_id")
);

-- CreateTable
CREATE TABLE "users_allergies" (
    "user_allergies_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "allergy_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_allergies_pkey" PRIMARY KEY ("user_allergies_id")
);

-- CreateTable
CREATE TABLE "users_diseases" (
    "user_disease_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "disease_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_diseases_pkey" PRIMARY KEY ("user_disease_id")
);

-- CreateTable
CREATE TABLE "users_honors" (
    "user_honor_id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "honor_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validate" BOOLEAN NOT NULL DEFAULT false,
    "certificate" VARCHAR NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "document" VARCHAR,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_honors_pkey" PRIMARY KEY ("user_honor_id")
);

-- CreateTable
CREATE TABLE "users_permissions" (
    "user_permission_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_permission_id")
);

-- CreateTable
CREATE TABLE "users_roles" (
    "user_role_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_role_id")
);

-- CreateTable
CREATE TABLE "medicines" (
    "medicine_id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" VARCHAR,
    "active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("medicine_id")
);

-- CreateTable
CREATE TABLE "relationship_types" (
    "relationship_type_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_types_pkey" PRIMARY KEY ("relationship_type_id")
);

-- CreateTable
CREATE TABLE "legal_representatives" (
    "id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "representative_user_id" UUID,
    "name" VARCHAR(100),
    "paternal_last_name" VARCHAR(100),
    "maternal_last_name" VARCHAR(100),
    "phone" VARCHAR(20),
    "relationship_type_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_representatives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_module_progress_user_id_class_id_module_id_key" ON "class_module_progress"("user_id", "class_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_modules_name_class_id_key" ON "class_modules"("name", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_section_progress_user_id_class_id_module_id_section_i_key" ON "class_section_progress"("user_id", "class_id", "module_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_sections_name_module_id_key" ON "class_sections"("name", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_name_key" ON "classes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "club_types_name_key" ON "club_types"("name");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_club_adv" ON "club_role_assignments"("club_adv_id");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_club_mg" ON "club_role_assignments"("club_mg_id");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_club_pathf" ON "club_role_assignments"("club_pathf_id");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_role" ON "club_role_assignments"("role_id");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_user" ON "club_role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "idx_club_role_assignments_year" ON "club_role_assignments"("ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_role_assignment_unique" ON "club_role_assignments"("user_id", "role_id", "club_adv_id", "club_pathf_id", "club_mg_id", "ecclesiastical_year_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "club_role_assignment_unique_refactored" ON "club_role_assignments"("user_id", "role_id", "club_adv_id", "club_pathf_id", "club_mg_id", "ecclesiastical_year_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_abbreviation_key" ON "countries"("abbreviation");

-- CreateIndex
CREATE INDEX "countries_active_idx" ON "countries"("active");

-- CreateIndex
CREATE INDEX "idx_enrollments_user_year" ON "enrollments"("user_id", "ecclesiastical_year_id");

-- CreateIndex
CREATE INDEX "idx_enrollments_status" ON "enrollments"("investiture_status");

-- CreateIndex
CREATE INDEX "idx_enrollments_locked" ON "enrollments"("locked_for_validation");

-- CreateIndex
CREATE INDEX "idx_enrollments_cross_type" ON "enrollments"("user_id", "cross_type_enrollment");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_user_id_class_id_ecclesiastical_year_id_key" ON "enrollments"("user_id", "class_id", "ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_name_type" ON "finances_categories"("name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "folders_name_key" ON "folders"("name");

-- CreateIndex
CREATE UNIQUE INDEX "honors_name_key" ON "honors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "honors_categories_name_key" ON "honors_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "local_fields_name_key" ON "local_fields"("name");

-- CreateIndex
CREATE UNIQUE INDEX "local_fields_abbreviation_key" ON "local_fields"("abbreviation");

-- CreateIndex
CREATE UNIQUE INDEX "master_honors_name_key" ON "master_honors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_permission_name_key" ON "permissions"("permission_name");

-- CreateIndex
CREATE INDEX "idx_permissions_name" ON "permissions"("permission_name");

-- CreateIndex
CREATE INDEX "idx_role_permissions_role_id" ON "role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "roles"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "unions_name_key" ON "unions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "unions_abbreviation_key" ON "unions"("abbreviation");

-- CreateIndex
CREATE UNIQUE INDEX "unit_members_user_id_key" ON "unit_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_pr_user_id_key" ON "users_pr"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_classes_user_id_class_id_key" ON "users_classes"("user_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "certifications_name_key" ON "certifications"("name");

-- CreateIndex
CREATE UNIQUE INDEX "certification_modules_name_certification_id_key" ON "certification_modules"("name", "certification_id");

-- CreateIndex
CREATE UNIQUE INDEX "certification_sections_name_module_id_key" ON "certification_sections"("name", "module_id");

-- CreateIndex
CREATE INDEX "idx_users_certifications_completion" ON "users_certifications"("user_id", "completion_status");

-- CreateIndex
CREATE UNIQUE INDEX "certification_module_progress_user_id_certification_id_modu_key" ON "certification_module_progress"("user_id", "certification_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "certification_section_progress_user_id_certification_id_mod_key" ON "certification_section_progress"("user_id", "certification_id", "module_id", "section_id");

-- CreateIndex
CREATE INDEX "idx_member_insurances_user_expiry" ON "member_insurances"("user_id", "end_date");

-- CreateIndex
CREATE INDEX "idx_investiture_history_enrollment" ON "investiture_validation_history"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "investiture_config_local_field_id_ecclesiastical_year_id_key" ON "investiture_config"("local_field_id", "ecclesiastical_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "diseases_name_key" ON "diseases"("name");

-- CreateIndex
CREATE UNIQUE INDEX "allergies_name_key" ON "allergies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_records_user_id_week_key" ON "weekly_records"("user_id", "week");

-- CreateIndex
CREATE UNIQUE INDEX "user_allergies_user_id_allergy_id_key" ON "users_allergies"("user_id", "allergy_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_diseases_user_id_disease_id_key" ON "users_diseases"("user_id", "disease_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_user_id_permission_id_key" ON "users_permissions"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "idx_users_roles_user_id" ON "users_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "users_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_types_name_key" ON "relationship_types"("name");

-- CreateIndex
CREATE INDEX "idx_relationship_types_name" ON "relationship_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "legal_representatives_user_id_key" ON "legal_representatives"("user_id");

-- CreateIndex
CREATE INDEX "idx_legal_reps_user" ON "legal_representatives"("user_id");

-- CreateIndex
CREATE INDEX "idx_legal_reps_representative" ON "legal_representatives"("representative_user_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_club_adv_id_fkey" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_club_mg_id_fkey" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_club_pathf_id_fkey" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments_folders" ADD CONSTRAINT "assignments_folders_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("folder_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments_folders" ADD CONSTRAINT "fk_assignments_folders_users_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_clubs_camporees" ADD CONSTRAINT "attending_clubs_camporees_camporee_id_fkey" FOREIGN KEY ("camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_clubs_camporees" ADD CONSTRAINT "attending_clubs_camporees_club_adv_id_fkey" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_clubs_camporees" ADD CONSTRAINT "attending_clubs_camporees_club_mg_id_fkey" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_clubs_camporees" ADD CONSTRAINT "attending_clubs_camporees_club_pathf_id_fkey" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_clubs_camporees" ADD CONSTRAINT "attending_clubs_camporees_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_members_camporees" ADD CONSTRAINT "attending_members_camporees_camporee_id_fkey" FOREIGN KEY ("camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_members_camporees" ADD CONSTRAINT "attending_members_camporees_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_members_camporees" ADD CONSTRAINT "attending_members_camporees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attending_members_camporees" ADD CONSTRAINT "attending_members_camporees_insurance_id_fkey" FOREIGN KEY ("insurance_id") REFERENCES "member_insurances"("insurance_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "churches" ADD CONSTRAINT "churches_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("district_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_module_progress" ADD CONSTRAINT "class_module_progress_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("class_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_module_progress" ADD CONSTRAINT "class_module_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_modules" ADD CONSTRAINT "class_modules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("class_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_section_progress" ADD CONSTRAINT "class_section_progress_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("class_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_section_progress" ADD CONSTRAINT "class_section_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "class_modules"("module_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_ideals" ADD CONSTRAINT "club_ideals_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_inventory" ADD CONSTRAINT "club_inventory_club_adv_id_fkey" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_inventory" ADD CONSTRAINT "club_inventory_club_mg_id_fkey" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_inventory" ADD CONSTRAINT "club_inventory_club_pathf_id_fkey" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("church_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("district_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_adventurers" ADD CONSTRAINT "club_adventurers_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_adventurers" ADD CONSTRAINT "club_adventurers_main_club_id_fkey" FOREIGN KEY ("main_club_id") REFERENCES "clubs"("club_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_pathfinders" ADD CONSTRAINT "club_pathfinders_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_pathfinders" ADD CONSTRAINT "club_pathfinders_main_club_id_fkey" FOREIGN KEY ("main_club_id") REFERENCES "clubs"("club_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_master_guild" ADD CONSTRAINT "club_master_guild_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_master_guild" ADD CONSTRAINT "club_master_guild_main_club_id_fkey" FOREIGN KEY ("main_club_id") REFERENCES "clubs"("club_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_club_adv_id_fkey" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_club_mg_id_fkey" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_club_pathf_id_fkey" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_year"("year_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "club_role_assignments" ADD CONSTRAINT "club_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("class_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_year"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_validated_by_fkey" FOREIGN KEY ("validated_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_club_adv_id_fkey" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_club_mg_id_fkey" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_club_pathf_id_fkey" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "finances" ADD CONSTRAINT "finances_finance_category_id_fkey" FOREIGN KEY ("finance_category_id") REFERENCES "finances_categories"("finance_category_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_club_type_fkey" FOREIGN KEY ("club_type") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_year"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules" ADD CONSTRAINT "folders_modules_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("folder_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules_records" ADD CONSTRAINT "fk_act_club_adventurers" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules_records" ADD CONSTRAINT "fk_act_club_master_guild" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules_records" ADD CONSTRAINT "fk_act_club_pathfinders" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules_records" ADD CONSTRAINT "folders_modules_records_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("folder_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_modules_records" ADD CONSTRAINT "folders_modules_records_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "folders_modules"("folder_module_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "fk_act_club_adventurers" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "fk_act_club_master_guild" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "fk_act_club_pathfinders" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "folders_section_records_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("folder_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "folders_section_records_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "folders_modules"("folder_module_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_section_records" ADD CONSTRAINT "folders_section_records_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "folders_sections"("folder_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folders_sections" ADD CONSTRAINT "folders_sections_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "folders_modules"("folder_module_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "honors" ADD CONSTRAINT "honors_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "honors" ADD CONSTRAINT "honors_honors_category_id_fkey" FOREIGN KEY ("honors_category_id") REFERENCES "honors_categories"("honor_category_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "honors" ADD CONSTRAINT "honors_master_honors_id_fkey" FOREIGN KEY ("master_honors_id") REFERENCES "master_honors"("master_honor_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "local_camporees" ADD CONSTRAINT "local_camporees_ecclesiastical_year_fkey" FOREIGN KEY ("ecclesiastical_year") REFERENCES "ecclesiastical_year"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "local_camporees" ADD CONSTRAINT "local_camporees_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "local_fields" ADD CONSTRAINT "local_fields_union_id_fkey" FOREIGN KEY ("union_id") REFERENCES "unions"("union_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "union_camporee_local_fields" ADD CONSTRAINT "union_camporee_local_fields_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "union_camporee_local_fields" ADD CONSTRAINT "union_camporee_local_fields_union_camporee_lf_id_fkey" FOREIGN KEY ("union_camporee_lf_id") REFERENCES "union_camporees"("union_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "union_camporees" ADD CONSTRAINT "union_camporees_ecclesiastical_year_fkey" FOREIGN KEY ("ecclesiastical_year") REFERENCES "ecclesiastical_year"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "union_camporees" ADD CONSTRAINT "union_camporees_union_id_fkey" FOREIGN KEY ("union_id") REFERENCES "unions"("union_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unions" ADD CONSTRAINT "unions_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit_members" ADD CONSTRAINT "unit_members_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("unit_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit_members" ADD CONSTRAINT "unit_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "fk_act_club_adventurers" FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "fk_act_club_master_guild" FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guild"("club_mg_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "fk_act_club_pathfinders" FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_advisor_id_fkey" FOREIGN KEY ("advisor_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("ct_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_secretary_id_fkey" FOREIGN KEY ("secretary_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_substitute_advisor_id_fkey" FOREIGN KEY ("substitute_advisor_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_union_id_fkey" FOREIGN KEY ("union_id") REFERENCES "unions"("union_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_pr" ADD CONSTRAINT "users_pr_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_classes" ADD CONSTRAINT "users_classes_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("class_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_classes" ADD CONSTRAINT "users_classes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_modules" ADD CONSTRAINT "certification_modules_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "certifications"("certification_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_sections" ADD CONSTRAINT "certification_sections_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "certification_modules"("module_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_certifications" ADD CONSTRAINT "users_certifications_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "certifications"("certification_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_certifications" ADD CONSTRAINT "users_certifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_module_progress" ADD CONSTRAINT "certification_module_progress_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "certifications"("certification_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_module_progress" ADD CONSTRAINT "certification_module_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_section_progress" ADD CONSTRAINT "certification_section_progress_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "certifications"("certification_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certification_section_progress" ADD CONSTRAINT "certification_section_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "member_insurances" ADD CONSTRAINT "member_insurances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "investiture_validation_history" ADD CONSTRAINT "investiture_validation_history_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("enrollment_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "investiture_validation_history" ADD CONSTRAINT "investiture_validation_history_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "investiture_config" ADD CONSTRAINT "investiture_config_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "investiture_config" ADD CONSTRAINT "investiture_config_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_year"("year_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_relationship_type_fkey" FOREIGN KEY ("relationship_type") REFERENCES "relationship_type"("relationship_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "weekly_records" ADD CONSTRAINT "weekly_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_allergies" ADD CONSTRAINT "user_allergies_allergy_id_fkey" FOREIGN KEY ("allergy_id") REFERENCES "allergies"("allergy_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_allergies" ADD CONSTRAINT "user_allergies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_diseases" ADD CONSTRAINT "user_diseases_disease_id_fkey" FOREIGN KEY ("disease_id") REFERENCES "diseases"("disease_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_diseases" ADD CONSTRAINT "user_diseases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_honors" ADD CONSTRAINT "user_honors_honor_id_fkey" FOREIGN KEY ("honor_id") REFERENCES "honors"("honor_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_honors" ADD CONSTRAINT "user_honors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_permissions" ADD CONSTRAINT "fk_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_permissions" ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_roles" ADD CONSTRAINT "fk_role" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users_roles" ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "legal_representatives" ADD CONSTRAINT "legal_representatives_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "legal_representatives" ADD CONSTRAINT "legal_representatives_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "legal_representatives" ADD CONSTRAINT "legal_representatives_relationship_type_id_fkey" FOREIGN KEY ("relationship_type_id") REFERENCES "relationship_types"("relationship_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
