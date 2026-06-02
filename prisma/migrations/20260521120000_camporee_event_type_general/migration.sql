-- ─────────────────────────────────────────────────────────────────────────────
-- Camporee event type — seed the "general" generic type used by agenda events.
--
-- Background: agenda events created from the admin timeline UI don't fit the
-- competition taxonomy (espiritual / recreativo / cultural / sports / técnico),
-- but `camporee_events.event_type_id` is NOT NULL because competition events
-- still need it. The frontend defaults to this generic type for agenda events
-- (see DEFAULT_AGENDA_EVENT_TYPE_CODE in sacdia-admin).
--
-- Idempotent via ON CONFLICT on the unique `code`.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "camporee_event_types" ("code", "name", "description", "display_order", "active")
VALUES
  ('general', 'General', 'Tipo genérico usado por eventos de agenda (no competencia)', 0, TRUE)
ON CONFLICT ("code") DO NOTHING;
