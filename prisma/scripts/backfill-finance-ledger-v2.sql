-- Idempotent while v2 writes remain disabled. Legacy rows and evidence photos
-- stay authoritative/readable; photos are attachments and never vouchers.
BEGIN;

DO $$
BEGIN
  IF (SELECT config_value FROM system_config
      WHERE config_key = 'finance.ledger_v2_writes_enabled') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'finance ledger v2 writes must remain disabled during backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM finances WHERE active AND club_section_id IS NULL) THEN
    RAISE EXCEPTION 'active legacy finances without club_section_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM finances f
    LEFT JOIN finances_categories c USING (finance_category_id)
    WHERE f.active AND (c.finance_category_id IS NULL OR NOT c.active OR c.type NOT IN (0, 1))
  ) THEN
    RAISE EXCEPTION 'active legacy finance has invalid finance category';
  END IF;
  IF EXISTS (SELECT 1 FROM finances WHERE active AND amount <= 0) THEN
    RAISE EXCEPTION 'active legacy finance amount must be positive';
  END IF;
  IF EXISTS (
    SELECT 1 FROM finances f
    JOIN finances_categories c USING (finance_category_id)
    JOIN finance_ledger_entries l ON l.legacy_finance_id = f.finance_id
    WHERE f.active AND (
      l.club_section_id IS DISTINCT FROM f.club_section_id
      OR l.finance_category_id <> f.finance_category_id
      OR l.kind <> (CASE c.type WHEN 0 THEN 'income' ELSE 'expense' END)::finance_ledger_entry_kind
      OR l.amount_centavos <> f.amount OR l.currency <> 'MXN'
      OR l.finance_date <> f.finance_date OR l.status <> 'approved'
      OR l.registered_by_id <> f.created_by OR l.decided_by_id IS NOT NULL
      OR l.rejection_reason IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'active legacy finance has drifted ledger entry';
  END IF;
END $$;

INSERT INTO finance_ledger_entries (
  legacy_finance_id, club_section_id, finance_category_id, kind,
  amount_centavos, currency, finance_date, status, registered_by_id,
  decided_at, created_at, updated_at
)
SELECT f.finance_id, f.club_section_id, f.finance_category_id,
  (CASE c.type WHEN 0 THEN 'income' ELSE 'expense' END)::finance_ledger_entry_kind,
  f.amount, 'MXN', f.finance_date, 'approved', f.created_by,
  COALESCE(f.modified_at, f.created_at, f.finance_date::timestamp AT TIME ZONE 'UTC'),
  COALESCE(f.created_at, f.finance_date::timestamp AT TIME ZONE 'UTC'),
  COALESCE(f.modified_at, f.created_at, f.finance_date::timestamp AT TIME ZONE 'UTC')
FROM finances f
JOIN finances_categories c USING (finance_category_id)
WHERE f.active
ON CONFLICT (legacy_finance_id) DO NOTHING;

INSERT INTO finance_ledger_events (
  finance_ledger_entry_id, event_type, actor_user_id, payload
)
SELECT l.finance_ledger_entry_id, 'MIGRATED_LEGACY', f.created_by,
  jsonb_build_object('legacy_finance_id', f.finance_id)
FROM finances f
JOIN finance_ledger_entries l ON l.legacy_finance_id = f.finance_id
WHERE f.active AND NOT EXISTS (
  SELECT 1 FROM finance_ledger_events e
  WHERE e.finance_ledger_entry_id = l.finance_ledger_entry_id
    AND e.event_type = 'MIGRATED_LEGACY'
);

DO $$
DECLARE
  legacy_count BIGINT;
  ledger_count BIGINT;
  legacy_total BIGINT;
  ledger_total BIGINT;
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0)
  INTO legacy_count, legacy_total FROM finances WHERE active;
  SELECT count(*), COALESCE(sum(l.amount_centavos), 0)
  INTO ledger_count, ledger_total
  FROM finances f JOIN finance_ledger_entries l ON l.legacy_finance_id = f.finance_id
  WHERE f.active;
  IF legacy_count <> ledger_count OR legacy_total <> ledger_total OR EXISTS (
    SELECT 1 FROM finances f
    JOIN finances_categories c USING (finance_category_id)
    LEFT JOIN finance_ledger_entries l ON l.legacy_finance_id = f.finance_id
    WHERE f.active AND (
      l.finance_ledger_entry_id IS NULL OR l.amount_centavos <> f.amount
      OR l.club_section_id IS DISTINCT FROM f.club_section_id
      OR l.finance_category_id <> f.finance_category_id
      OR l.kind <> (CASE c.type WHEN 0 THEN 'income' ELSE 'expense' END)::finance_ledger_entry_kind
      OR l.currency <> 'MXN' OR l.finance_date <> f.finance_date
      OR l.status <> 'approved' OR l.registered_by_id <> f.created_by
      OR l.decided_by_id IS NOT NULL OR l.rejection_reason IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'active legacy finance entry parity failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM finances f
    JOIN finance_ledger_entries l ON l.legacy_finance_id = f.finance_id
    LEFT JOIN finance_ledger_events e
      ON e.finance_ledger_entry_id = l.finance_ledger_entry_id
      AND e.event_type = 'MIGRATED_LEGACY'
    WHERE f.active
    GROUP BY f.finance_id, f.created_by
    HAVING count(e.finance_ledger_event_id) <> 1
      OR bool_or(e.actor_user_id <> f.created_by)
      OR bool_or(e.payload ->> 'legacy_finance_id' <> f.finance_id::text)
  ) THEN
    RAISE EXCEPTION 'active legacy finance event parity failed';
  END IF;
END $$;

COMMIT;
