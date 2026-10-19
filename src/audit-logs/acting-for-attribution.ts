import { getAuditActingFor } from './audit-request-context';

export interface ActingForAttributable {
  actor_user_id?: string | null;
  actor_kind?: string | null;
  target_user_id?: string | null;
  request_context?: Record<string, unknown> | null;
}

/**
 * Re-attributes an audit row written while a guardian acts for a dependent.
 *
 * Domain code records the SUBJECT (the dependent) as the actor, because that is
 * who `request.user` is. When the ambient audit context says a guardian is
 * acting, and the row's actor is missing or is that same subject, the real
 * actor becomes the guardian (`actor_kind = 'guardian_acting'`) and the
 * dependent moves to `target_user_id`. A row whose actor is somebody else
 * (e.g. a director reviewing the dependent) is left untouched.
 *
 * Pass `withRequestContext: false` for writers whose stored shape is compared
 * byte for byte (the critical writer): they get actor/target only.
 */
export function applyActingForAttribution<T extends ActingForAttributable>(
  row: T,
  options: { withRequestContext?: boolean } = {},
): T {
  const actingFor = getAuditActingFor();
  if (!actingFor || row.actor_kind === 'system') {
    return row;
  }

  const actorIsSubjectOrMissing =
    row.actor_user_id === undefined ||
    row.actor_user_id === null ||
    row.actor_user_id === actingFor.subjectUserId;
  if (!actorIsSubjectOrMissing) {
    return row;
  }

  const attributed: T = {
    ...row,
    actor_user_id: actingFor.actorUserId,
    actor_kind: actingFor.kind,
    target_user_id: row.target_user_id ?? actingFor.subjectUserId,
  };

  if (options.withRequestContext !== false) {
    attributed.request_context = {
      ...(row.request_context ?? {}),
      acting_for: {
        guardian_user_id: actingFor.actorUserId,
        dependent_user_id: actingFor.subjectUserId,
        guardianship_id: actingFor.guardianshipId,
      },
    };
  }

  return attributed;
}
