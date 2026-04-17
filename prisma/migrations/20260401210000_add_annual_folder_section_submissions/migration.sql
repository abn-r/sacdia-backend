-- CreateTable: per-section submission tracking for annual folders
-- This allows club users to submit individual sections without affecting
-- the overall folder status, which is a coordinator/admin operation.

CREATE TABLE annual_folder_section_submissions (
  section_submission_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  annual_folder_id      UUID NOT NULL REFERENCES annual_folders(annual_folder_id) ON DELETE CASCADE,
  section_id            UUID NOT NULL REFERENCES folder_template_sections(section_id),
  submitted_by          UUID NOT NULL REFERENCES users(user_id),
  submitted_at          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  modified_at           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  UNIQUE(annual_folder_id, section_id)
);

CREATE INDEX idx_section_submissions_folder  ON annual_folder_section_submissions(annual_folder_id);
CREATE INDEX idx_section_submissions_section ON annual_folder_section_submissions(section_id);
