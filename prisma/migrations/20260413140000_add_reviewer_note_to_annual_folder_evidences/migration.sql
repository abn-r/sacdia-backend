-- AlterTable: annual_folder_evidences
-- Add reviewer_note, reviewer_noted_by, reviewer_noted_at fields for granular
-- per-file feedback by LF reviewers (assistant-lf / director-lf).
-- Surgical fix — does NOT touch section evaluations or folder status machine.
-- Part of: annual-folders-ownership-rework (SDD, pending).

ALTER TABLE "annual_folder_evidences"
  ADD COLUMN "reviewer_note" TEXT,
  ADD COLUMN "reviewer_noted_by" UUID REFERENCES "users"("user_id") ON DELETE SET NULL,
  ADD COLUMN "reviewer_noted_at" TIMESTAMPTZ;
