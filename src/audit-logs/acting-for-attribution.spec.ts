import { applyActingForAttribution } from './acting-for-attribution';
import {
  getAuditContext,
  runWithAuditContext,
  setAuditActingFor,
} from './audit-request-context';

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

  describe('supervised_user and linked_device', () => {
    const inContext = <T>(
      actingFor: Parameters<typeof setAuditActingFor>[0],
      fn: () => T,
    ): T =>
      runWithAuditContext(() => {
        setAuditActingFor(actingFor);
        return fn();
      });

    it('tags a teen request with actor_kind supervised_user and keeps the teen as actor', () => {
      const result = inContext(
        {
          actorUserId: 'teen-1',
          subjectUserId: 'teen-1',
          kind: 'supervised_user',
        },
        () => applyActingForAttribution({ actor_user_id: 'teen-1' }),
      );

      expect(result).toEqual({
        actor_user_id: 'teen-1',
        actor_kind: 'supervised_user',
      });
    });

    it('fills a missing actor with the teen', () => {
      const result = inContext(
        {
          actorUserId: 'teen-1',
          subjectUserId: 'teen-1',
          kind: 'supervised_user',
        },
        () => applyActingForAttribution({ actor_user_id: null }),
      );

      expect(result).toMatchObject({
        actor_user_id: 'teen-1',
        actor_kind: 'supervised_user',
      });
    });

    it('does not add a target or an acting_for context for a teen', () => {
      const result = inContext(
        {
          actorUserId: 'teen-1',
          subjectUserId: 'teen-1',
          kind: 'supervised_user',
        },
        () =>
          applyActingForAttribution({
            actor_user_id: 'teen-1',
            request_context: { a: 1 },
          }),
      );

      expect(result).not.toHaveProperty('target_user_id');
      expect(result.request_context).toEqual({ a: 1 });
    });

    it('leaves a row written by somebody else untouched (a director reviewing the teen)', () => {
      const row = { actor_user_id: 'director-1' };
      const result = inContext(
        {
          actorUserId: 'teen-1',
          subjectUserId: 'teen-1',
          kind: 'supervised_user',
        },
        () => applyActingForAttribution(row),
      );

      expect(result).toBe(row);
    });

    it('records the device id in the request context for a linked device', () => {
      const result = inContext(
        {
          actorUserId: 'child-1',
          subjectUserId: 'child-1',
          kind: 'linked_device',
          linkedDeviceId: 'dev-1',
          guardianshipId: 'gs-1',
        },
        () =>
          applyActingForAttribution({
            actor_user_id: 'child-1',
            request_context: { a: 1 },
          }),
      );

      expect(result).toMatchObject({
        actor_user_id: 'child-1',
        actor_kind: 'linked_device',
        request_context: { a: 1, linked_device_id: 'dev-1' },
      });
    });

    it('omits the device context for the critical writer', () => {
      const result = inContext(
        {
          actorUserId: 'child-1',
          subjectUserId: 'child-1',
          kind: 'linked_device',
          linkedDeviceId: 'dev-1',
        },
        () =>
          applyActingForAttribution(
            { actor_user_id: 'child-1' },
            { withRequestContext: false },
          ),
      );

      expect(result).toEqual({
        actor_user_id: 'child-1',
        actor_kind: 'linked_device',
      });
    });

    it('guardian_acting output is unchanged (regression snapshot)', () => {
      const result = inContext(
        {
          actorUserId: 'guardian-1',
          subjectUserId: 'dependent-1',
          guardianshipId: 'gs-1',
          kind: 'guardian_acting',
        },
        () => applyActingForAttribution({ actor_user_id: 'dependent-1' }),
      );

      expect(result).toEqual({
        actor_user_id: 'guardian-1',
        actor_kind: 'guardian_acting',
        target_user_id: 'dependent-1',
        request_context: {
          acting_for: {
            guardian_user_id: 'guardian-1',
            dependent_user_id: 'dependent-1',
            guardianship_id: 'gs-1',
          },
        },
      });
    });
  });
});
