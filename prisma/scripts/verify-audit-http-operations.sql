-- Verification for 20260812190000_audit_http_operations.
-- Silent on success; raises an exception describing the first missing piece.
DO $$
DECLARE
  col_count int;
  idx_count int;
  mig_count int;
  source_default text;
BEGIN
  SELECT count(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'audit_logs'
    AND column_name IN ('source', 'request_context');
  IF col_count <> 2 THEN
    RAISE EXCEPTION 'audit_logs is missing source/request_context (found % of 2)', col_count;
  END IF;

  SELECT column_default INTO source_default
  FROM information_schema.columns
  WHERE table_name = 'audit_logs' AND column_name = 'source';
  IF source_default IS DISTINCT FROM '''service''::character varying' THEN
    RAISE EXCEPTION 'audit_logs.source default is % (expected ''service'')', source_default;
  END IF;

  SELECT count(*) INTO idx_count
  FROM pg_indexes
  WHERE tablename = 'audit_logs' AND indexname = 'idx_audit_logs_created';
  IF idx_count <> 1 THEN
    RAISE EXCEPTION 'idx_audit_logs_created index is missing';
  END IF;

  SELECT count(*) INTO mig_count
  FROM _prisma_migrations
  WHERE migration_name = '20260812190000_audit_http_operations'
    AND finished_at IS NOT NULL;
  IF mig_count <> 1 THEN
    RAISE EXCEPTION '_prisma_migrations row for 20260812190000_audit_http_operations is missing or unfinished';
  END IF;

  -- Round-trip probe: insert an http-source row and remove it.
  INSERT INTO audit_logs (entity_type, entity_id, action, source, request_context, result, actor_kind, summary)
  VALUES ('audit_verify', 'probe', 'UPDATED', 'http',
          '{"method": "PATCH", "status_code": 200}', 'succeeded', 'user',
          'verify-audit-http-operations probe');
  DELETE FROM audit_logs
  WHERE entity_type = 'audit_verify' AND entity_id = 'probe';
END $$;
