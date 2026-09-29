-- Intention to attend a virtual activity. Distinct from confirmed attendance
-- stored in activities.attendees. Shape: { "<user_id>": "going" | "not_going" }.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS rsvp jsonb;
