import { applyActingForAttribution } from './acting-for-attribution';
import { getAuditContext, runWithAuditContext } from './audit-request-context';

describe('applyActingForAttribution', () => {
  const inActingContext = <T>(fn: () => T): T =>
    runWithAuditContext(() => {
      const context = getAuditContext();
      if (context) {
        context.actingFor = {
          actorUserId: 'guardian-1',
          subjectUserId: 'dependent-1',
          guardianshipId: 'gs-1',
          kind: 'guardian_acting',
        };
      }
      return fn();
    });

  it('returns the very same row outside an acting request', () => {
    const row = { actor_user_id: 'dependent-1' };
    expect(applyActingForAttribution(row)).toBe(row);
    expect(runWithAuditContext(() => applyActingForAttribution(row))).toBe(row);
  });

  it('swaps actor and target when the actor is the acted subject', () => {
    const result = inActingContext(() =>
      applyActingForAttribution({ actor_user_id: 'dependent-1' }),
    );

    expect(result).toMatchObject({
      actor_user_id: 'guardian-1',
      actor_kind: 'guardian_acting',
      target_user_id: 'dependent-1',
    });
  });

  it('omits request_context when asked (critical writer)', () => {
    const result = inActingContext(() =>
      applyActingForAttribution(
        { actor_user_id: 'dependent-1' },
        { withRequestContext: false },
      ),
    );

    expect(result).not.toHaveProperty('request_context');
  });

  it('does not mutate its input', () => {
    const row = { actor_user_id: 'dependent-1', request_context: { a: 1 } };
    inActingContext(() => applyActingForAttribution(row));

    expect(row).toEqual({
      actor_user_id: 'dependent-1',
      request_context: { a: 1 },
    });
  });
});
