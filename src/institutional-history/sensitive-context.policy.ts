export const PROHIBITED_HIERARCHY_CONTEXT_KEYS = [
  'blood',
  'blood_type',
  'allergy',
  'allergies',
  'disease',
  'diseases',
  'medicine',
  'medicines',
  'health',
  'medical',
  'phone',
  'emergency_contact',
  'emergency_contacts',
  'legal_representative',
  'legal_representatives',
  'document',
  'documents',
  'password',
  'token',
  'secret',
] as const;

export function buildRecursiveProhibitedContextKeysSql(
  keys: readonly string[] = PROHIBITED_HIERARCHY_CONTEXT_KEYS,
): string {
  const arrayLiteral = keys
    .map((key) => `'${key.replaceAll("'", "''")}'`)
    .join(', ');

  return `
    WITH RECURSIVE context_tree AS (
      SELECT
        hc.hierarchy_context_id,
        NULL::text AS key,
        hc.context::jsonb AS value
      FROM hierarchy_contexts hc
      WHERE hc.context IS NOT NULL

      UNION ALL

      SELECT
        context_tree.hierarchy_context_id,
        child.key,
        child.value
      FROM context_tree
      CROSS JOIN LATERAL (
        SELECT object_entry.key, object_entry.value
        FROM jsonb_each(
          CASE
            WHEN jsonb_typeof(context_tree.value) = 'object'
              THEN context_tree.value
            ELSE '{}'::jsonb
          END
        ) AS object_entry(key, value)

        UNION ALL

        SELECT NULL::text AS key, array_entry.value
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(context_tree.value) = 'array'
              THEN context_tree.value
            ELSE '[]'::jsonb
          END
        ) AS array_entry(value)
      ) AS child(key, value)
    )
    SELECT COUNT(*)::int AS failures
    FROM context_tree
    WHERE key IS NOT NULL
      AND lower(key) = ANY (ARRAY[${arrayLiteral}]::text[])
  `;
}
