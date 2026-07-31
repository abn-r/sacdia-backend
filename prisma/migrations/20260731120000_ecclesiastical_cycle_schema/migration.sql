BEGIN;

CREATE TABLE ecclesiastical_cycle_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_field_id INTEGER NOT NULL REFERENCES local_fields(local_field_id) ON DELETE RESTRICT,
  target_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'planned',
  owner_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  lease_token UUID, lease_expires_at TIMESTAMPTZ,
  capabilities_snapshot JSONB NOT NULL DEFAULT '{}', summary JSONB,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ecclesiastical_cycle_runs_local_field_year_key UNIQUE (local_field_id, target_year_id),
  CONSTRAINT ecclesiastical_cycle_runs_id_year_key UNIQUE (run_id, target_year_id),
  CONSTRAINT ecclesiastical_cycle_runs_status_check CHECK (status IN ('planned','running','completed','blocked','failed')),
  CONSTRAINT ecclesiastical_cycle_runs_lease_check CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT ecclesiastical_cycle_runs_running_lease_check CHECK (status <> 'running' OR lease_token IS NOT NULL),
  CONSTRAINT ecclesiastical_cycle_runs_completed_at_check CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT ecclesiastical_cycle_runs_capabilities_check CHECK (jsonb_typeof(capabilities_snapshot) = 'object'),
  CONSTRAINT ecclesiastical_cycle_runs_summary_check CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object')
);
CREATE INDEX ecclesiastical_cycle_runs_status_lease_idx ON ecclesiastical_cycle_runs(status, lease_expires_at);

CREATE TABLE ecclesiastical_cycle_decisions (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  source_assignment_id UUID NOT NULL REFERENCES club_role_assignments(assignment_id) ON DELETE RESTRICT,
  source_enrollment_id INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE RESTRICT,
  target_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id) ON DELETE RESTRICT,
  canonical_transition_id INTEGER,
  target_class_id INTEGER REFERENCES classes(class_id) ON DELETE RESTRICT,
  target_club_section_id INTEGER REFERENCES club_sections(club_section_id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'planned', reason_code VARCHAR(96), actor_user_id UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  effect_refs JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ecclesiastical_cycle_decisions_member_source_year_key UNIQUE (user_id, source_assignment_id, target_year_id),
  CONSTRAINT ecclesiastical_cycle_decisions_id_run_key UNIQUE (decision_id, run_id),
  CONSTRAINT ecclesiastical_cycle_decisions_run_year_fkey FOREIGN KEY (run_id, target_year_id) REFERENCES ecclesiastical_cycle_runs(run_id, target_year_id) ON DELETE RESTRICT,
  CONSTRAINT ecclesiastical_cycle_decisions_status_check CHECK (status IN ('planned','pending_choice','waiting','change_requested','applied','blocked')),
  CONSTRAINT ecclesiastical_cycle_decisions_block_reason_check CHECK (status <> 'blocked' OR reason_code IS NOT NULL),
  CONSTRAINT ecclesiastical_cycle_decisions_destination_check CHECK (status NOT IN ('planned','applied') OR (target_class_id IS NOT NULL AND target_club_section_id IS NOT NULL)),
  CONSTRAINT ecclesiastical_cycle_decisions_effect_refs_check CHECK (jsonb_typeof(effect_refs) = 'array' AND (status <> 'applied' OR jsonb_array_length(effect_refs) > 0))
);
CREATE INDEX ecclesiastical_cycle_decisions_run_status_idx ON ecclesiastical_cycle_decisions(run_id, status);
CREATE INDEX ecclesiastical_cycle_decisions_source_enrollment_idx ON ecclesiastical_cycle_decisions(source_enrollment_id);
CREATE INDEX ecclesiastical_cycle_decisions_target_section_status_idx ON ecclesiastical_cycle_decisions(target_club_section_id, status);

CREATE TABLE ecclesiastical_cycle_events (
  event_id BIGSERIAL PRIMARY KEY, run_id UUID NOT NULL REFERENCES ecclesiastical_cycle_runs(run_id) ON DELETE RESTRICT,
  decision_id UUID,
  event_key VARCHAR(160) NOT NULL CONSTRAINT ecclesiastical_cycle_events_event_key_key UNIQUE,
  event_type VARCHAR(48) NOT NULL, actor_user_id UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  payload JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ecclesiastical_cycle_events_type_check CHECK (event_type IN ('RUN_STARTED','RUN_BLOCKED','RUN_COMPLETED','DECISION_PLANNED','CHOICE_RECORDED','APPLY_ATTEMPTED','EFFECT_CONFIRMED','COMPENSATION_RECORDED')),
  CONSTRAINT ecclesiastical_cycle_events_kind_check CHECK (
    (event_type LIKE 'RUN_%' AND decision_id IS NULL) OR
    (event_type NOT LIKE 'RUN_%' AND decision_id IS NOT NULL)
  ),
  CONSTRAINT ecclesiastical_cycle_events_decision_run_fkey FOREIGN KEY (decision_id, run_id) REFERENCES ecclesiastical_cycle_decisions(decision_id, run_id) ON DELETE RESTRICT,
  CONSTRAINT ecclesiastical_cycle_events_payload_check CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX ecclesiastical_cycle_events_decision_created_idx ON ecclesiastical_cycle_events(decision_id, created_at);
CREATE INDEX ecclesiastical_cycle_events_run_created_idx ON ecclesiastical_cycle_events(run_id, created_at);
CREATE INDEX ecclesiastical_cycle_events_type_created_idx ON ecclesiastical_cycle_events(event_type, created_at);

CREATE FUNCTION prevent_ecclesiastical_cycle_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ecclesiastical cycle events are append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ecclesiastical_cycle_events_append_only
BEFORE UPDATE OR DELETE ON ecclesiastical_cycle_events
FOR EACH ROW EXECUTE FUNCTION prevent_ecclesiastical_cycle_event_mutation();

COMMIT;
