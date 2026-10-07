CREATE TYPE "investiture_request_person_status" AS ENUM (
  'PENDING',
  'INVESTED',
  'REJECTED_BY_PERSON',
  'REJECTED_BY_SYSTEM',
  'REMOVED',
  'CLOSED_YEAR'
);

CREATE TABLE "investiture_authorization_requests" (
  "request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "club_section_id" INTEGER NOT NULL,
  "ecclesiastical_year_id" INTEGER NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "investiture_authorization_requests_pkey" PRIMARY KEY ("request_id")
);

CREATE INDEX "idx_investiture_authorization_requests_section_year"
ON "investiture_authorization_requests" ("club_section_id", "ecclesiastical_year_id");

CREATE TABLE "investiture_authorization_people" (
  "person_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "class_id" INTEGER NOT NULL,
  "enrollment_id" INTEGER NOT NULL,
  "investiture_date" DATE NOT NULL,
  "status" "investiture_request_person_status" NOT NULL DEFAULT 'PENDING',
  "single_slot" BOOLEAN NOT NULL,
  "resolution_code" VARCHAR(80),
  "resolved_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "investiture_authorization_people_pkey" PRIMARY KEY ("person_id")
);

CREATE INDEX "idx_investiture_authorization_people_request_status"
ON "investiture_authorization_people" ("request_id", "status");

CREATE INDEX "idx_investiture_authorization_people_enrollment_status"
ON "investiture_authorization_people" ("enrollment_id", "status");

CREATE INDEX "idx_investiture_authorization_people_user_status"
ON "investiture_authorization_people" ("user_id", "status");

CREATE UNIQUE INDEX "uniq_investiture_authorization_people_pending_class"
ON "investiture_authorization_people" ("user_id", "class_id")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "uniq_investiture_authorization_people_pending_single_slot"
ON "investiture_authorization_people" ("user_id")
WHERE "status" = 'PENDING' AND "single_slot" = true;

ALTER TABLE "investiture_authorization_requests"
ADD CONSTRAINT "investiture_authorization_requests_section_fkey"
FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "investiture_authorization_requests"
ADD CONSTRAINT "investiture_authorization_requests_year_fkey"
FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "investiture_authorization_people"
ADD CONSTRAINT "investiture_authorization_people_request_fkey"
FOREIGN KEY ("request_id") REFERENCES "investiture_authorization_requests"("request_id")
ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "investiture_authorization_people"
ADD CONSTRAINT "investiture_authorization_people_enrollment_fkey"
FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("enrollment_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
