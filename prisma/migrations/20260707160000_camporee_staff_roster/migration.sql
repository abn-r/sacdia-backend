-- Camporee staff roster, flexible agenda assignments, and club-registration closure.

ALTER TABLE "local_camporees"
  ADD COLUMN "club_registration_closed_at" TIMESTAMPTZ(6),
  ADD COLUMN "club_registration_closed_by" UUID;

ALTER TABLE "union_camporees"
  ADD COLUMN "club_registration_closed_at" TIMESTAMPTZ(6),
  ADD COLUMN "club_registration_closed_by" UUID;

CREATE TABLE "camporee_staff_members" (
  "camporee_staff_member_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "local_camporee_id" INTEGER,
  "union_camporee_id" INTEGER,
  "user_id" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "role_label" VARCHAR(100),
  "notes" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_staff_members_scope_check" CHECK (
    ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
    OR
    ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
  ),
  CONSTRAINT "camporee_staff_members_category_check" CHECK (
    "category" IN ('judge', 'administrative', 'kitchen', 'support', 'spiritual', 'leadership', 'other')
  ),
  CONSTRAINT "camporee_staff_members_status_check" CHECK (
    "status" IN ('active', 'inactive')
  ),
  CONSTRAINT "camporee_staff_members_local_fkey" FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_staff_members_union_fkey" FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_staff_members_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "camporee_staff_members_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "camporee_staff_members_modifier_fkey" FOREIGN KEY ("modified_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_camporee_staff_local_active" ON "camporee_staff_members"("local_camporee_id", "active");
CREATE INDEX "idx_camporee_staff_union_active" ON "camporee_staff_members"("union_camporee_id", "active");
CREATE INDEX "idx_camporee_staff_user" ON "camporee_staff_members"("user_id");
CREATE UNIQUE INDEX "uq_camporee_staff_local_active_user" ON "camporee_staff_members"("local_camporee_id", "user_id") WHERE "active" = TRUE AND "local_camporee_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_camporee_staff_union_active_user" ON "camporee_staff_members"("union_camporee_id", "user_id") WHERE "active" = TRUE AND "union_camporee_id" IS NOT NULL;

CREATE TABLE "camporee_event_staff_assignments" (
  "camporee_event_staff_assignment_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_id" INTEGER NOT NULL,
  "camporee_staff_member_id" UUID NOT NULL,
  "assignment_role" VARCHAR(30) NOT NULL,
  "title_override" VARCHAR(100),
  "notes" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_staff_assignment_role_check" CHECK (
    "assignment_role" IN ('responsible', 'assistant', 'evaluator', 'support')
  ),
  CONSTRAINT "camporee_event_staff_event_fkey" FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_event_staff_member_fkey" FOREIGN KEY ("camporee_staff_member_id") REFERENCES "camporee_staff_members"("camporee_staff_member_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_event_staff_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "camporee_event_staff_modifier_fkey" FOREIGN KEY ("modified_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_camporee_event_staff_event" ON "camporee_event_staff_assignments"("camporee_event_id", "active", "display_order");
CREATE INDEX "idx_camporee_event_staff_member" ON "camporee_event_staff_assignments"("camporee_staff_member_id", "active");
CREATE UNIQUE INDEX "uq_camporee_event_staff_active_member_role" ON "camporee_event_staff_assignments"("camporee_event_id", "camporee_staff_member_id", "assignment_role") WHERE "active" = TRUE;

-- Backfill existing scoring judges into the general camporee staff roster.
INSERT INTO "camporee_staff_members" (
  "local_camporee_id",
  "union_camporee_id",
  "user_id",
  "category",
  "role_label",
  "notes",
  "status",
  "active",
  "created_by",
  "modified_by",
  "created_at",
  "modified_at"
)
SELECT
  cj."local_camporee_id",
  cj."union_camporee_id",
  cj."user_id",
  'judge',
  'Juez',
  cj."notes",
  cj."status",
  cj."active",
  cj."created_by",
  cj."modified_by",
  cj."created_at",
  cj."modified_at"
FROM "camporee_judges" cj
ON CONFLICT DO NOTHING;
