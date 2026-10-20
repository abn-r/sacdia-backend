import {
  runWithAuditContext,
  setAuditActingFor,
} from '../audit-logs/audit-request-context';
import { GuardianNotificationsService } from './guardian-notifications.service';

const DEPENDENT = 'dddddddd-0000-4000-8000-000000000001';
const G1 = 'gggggggg-0000-4000-8000-000000000001';
const G2 = 'gggggggg-0000-4000-8000-000000000002';

function setup(dependent: unknown) {
  const prisma: any = {
    users: { findFirst: jest.fn().mockResolvedValue(dependent) },
  };
  const notifications: any = {
    sendToUser: jest.fn().mockResolvedValue({ success: true }),
  };
  return {
    service: new GuardianNotificationsService(prisma, notifications),
    prisma,
    notifications,
  };
}

const dependentWith = (guardians: string[], name = 'Ana María') => ({
  name,
  guardianships_as_dependent: guardians.map((id) => ({ guardian_user_id: id })),
});

describe('GuardianNotificationsService.onDependentEvidenceUploaded', () => {
  it('notifies every active guardian with the family source and dependent id', async () => {
    const { service, notifications } = setup(dependentWith([G1, G2]));

    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'class_section',
      entityLabel: 'Amigo',
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      {
        userId: G1,
        title: 'Ana subió evidencia',
        body: 'Se subió evidencia de una clase: Amigo.',
        data: {
          type: 'dependent_evidence_uploaded',
          dependent_user_id: DEPENDENT,
        },
      },
      'system',
      'family:evidence_uploaded',
    );
    expect(notifications.sendToUser.mock.calls[1][0].userId).toBe(G2);
  });

  it('is a no-op when the target is not a dependent (or is frozen / purged / inactive)', async () => {
    const { service, notifications, prisma } = setup(null);
    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'honor',
    });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(prisma.users.findFirst.mock.calls[0][0].where).toMatchObject({
      user_id: DEPENDENT,
      active: true,
      dependent_profile: { is: { frozen_at: null, purged_at: null } },
    });
    // A linked teen HAS an account: the lookup must not exclude them.
    expect(prisma.users.findFirst.mock.calls[0][0].where).not.toHaveProperty(
      'account',
    );
  });

  it('notifies the guardians of a dependent that holds an account (a linked teen) when STAFF upload', async () => {
    const { service, notifications } = setup(dependentWith([G1]));

    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'class_section',
      actorUserId: 'staff-1',
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify when a supervised teen uploads their own evidence (P3-A11: the summary covers it)', async () => {
    const { service, notifications, prisma } = setup(dependentWith([G1]));

    await runWithAuditContext(async () => {
      setAuditActingFor({
        actorUserId: DEPENDENT,
        subjectUserId: DEPENDENT,
        kind: 'supervised_user',
      });
      await service.onDependentEvidenceUploaded({
        dependentUserId: DEPENDENT,
        kind: 'class_section',
        actorUserId: DEPENDENT,
      });
    });

    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  describe('a linked device uploads (3b, FP3-47)', () => {
    const asDevice = <T>(fn: () => Promise<T>) =>
      runWithAuditContext(async () => {
        setAuditActingFor({
          actorUserId: DEPENDENT,
          subjectUserId: DEPENDENT,
          guardianshipId: 'gs-1',
          linkedDeviceId: 'dev-1',
          kind: 'linked_device',
        });
        return fn();
      });

    it('notifies EVERY verified guardian even though the audit subject is the child (the regression: a subject-only check silenced the device)', async () => {
      const { service, notifications } = setup(dependentWith([G1, G2]));

      await asDevice(() =>
        service.onDependentEvidenceUploaded({
          dependentUserId: DEPENDENT,
          kind: 'class_section',
          actorUserId: DEPENDENT,
        }),
      );

      expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
      expect(
        notifications.sendToUser.mock.calls.map((c: any[]) => c[0].userId),
      ).toEqual([G1, G2]);
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Ana subió evidencia',
          data: {
            type: 'dependent_evidence_uploaded',
            dependent_user_id: DEPENDENT,
          },
        }),
        'system',
        'family:evidence_uploaded',
      );
    });

    it('10 uploads in a row are 10 notices per guardian (each upload, no coalescing)', async () => {
      const { service, notifications } = setup(dependentWith([G1]));

      for (let i = 0; i < 10; i += 1) {
        await asDevice(() =>
          service.onDependentEvidenceUploaded({
            dependentUserId: DEPENDENT,
            kind: 'class_section',
            actorUserId: DEPENDENT,
          }),
        );
      }

      expect(notifications.sendToUser).toHaveBeenCalledTimes(10);
    });

    it('a notifier failure never throws (the upload already returned 201)', async () => {
      const { service, notifications } = setup(dependentWith([G1, G2]));
      notifications.sendToUser.mockRejectedValue(new Error('push down'));

      await expect(
        asDevice(() =>
          service.onDependentEvidenceUploaded({
            dependentUserId: DEPENDENT,
            kind: 'class_section',
            actorUserId: DEPENDENT,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    });

    it('a lookup failure never throws either', async () => {
      const { service, prisma } = setup(dependentWith([G1]));
      prisma.users.findFirst.mockRejectedValue(new Error('db down'));

      await expect(
        asDevice(() =>
          service.onDependentEvidenceUploaded({
            dependentUserId: DEPENDENT,
            kind: 'class_section',
            actorUserId: DEPENDENT,
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it('a teen still suppresses (P3-A11) and a guardian acting still suppresses: only the DEVICE changed', async () => {
      for (const kind of ['supervised_user', 'guardian_acting'] as const) {
        const { service, notifications } = setup(dependentWith([G1]));
        await runWithAuditContext(async () => {
          setAuditActingFor({
            actorUserId: DEPENDENT,
            subjectUserId: DEPENDENT,
            kind,
          });
          await service.onDependentEvidenceUploaded({
            dependentUserId: DEPENDENT,
            kind: 'class_section',
          });
        });
        expect(notifications.sendToUser).not.toHaveBeenCalled();
      }
    });
  });

  it('is a no-op while a guardian acts for that very child (Phase 2 uploads)', async () => {
    const { service, notifications, prisma } = setup(dependentWith([G1]));

    await runWithAuditContext(async () => {
      setAuditActingFor({
        actorUserId: G1,
        subjectUserId: DEPENDENT,
        guardianshipId: 'gs-1',
        kind: 'guardian_acting',
      });
      await service.onDependentEvidenceUploaded({
        dependentUserId: DEPENDENT,
        kind: 'honor_requirement',
      });
    });

    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it('still notifies when the acting context belongs to ANOTHER child', async () => {
    const { service, notifications } = setup(dependentWith([G1]));

    await runWithAuditContext(async () => {
      setAuditActingFor({
        actorUserId: G2,
        subjectUserId: 'someone-else',
        guardianshipId: 'gs-9',
        kind: 'guardian_acting',
      });
      await service.onDependentEvidenceUploaded({
        dependentUserId: DEPENDENT,
        kind: 'honor',
      });
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('never notifies the actor about their own upload', async () => {
    const { service, notifications } = setup(dependentWith([G1, G2]));
    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'honor',
      actorUserId: G1,
    });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser.mock.calls[0][0].userId).toBe(G2);
  });

  it('does nothing when the actor is the only guardian', async () => {
    const { service, notifications } = setup(dependentWith([G1]));
    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'honor',
      actorUserId: G1,
    });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('only reads real, active, non-test user guardians', async () => {
    const { service, prisma } = setup(dependentWith([G1]));
    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'honor',
    });
    expect(
      prisma.users.findFirst.mock.calls[0][0].select.guardianships_as_dependent
        .where,
    ).toMatchObject({
      consent_status: { not: 'revoked' },
      is_custodian: false,
      is_test_data: false,
      guardian_user_id: { not: null },
    });
  });

  it('never throws, so it cannot fail an upload that already succeeded', async () => {
    const { service, prisma, notifications } = setup(dependentWith([G1]));
    prisma.users.findFirst.mockRejectedValue(new Error('db down'));
    await expect(
      service.onDependentEvidenceUploaded({
        dependentUserId: DEPENDENT,
        kind: 'honor',
      }),
    ).resolves.toBeUndefined();

    prisma.users.findFirst.mockResolvedValue(dependentWith([G1, G2]));
    notifications.sendToUser.mockRejectedValue(new Error('fcm down'));
    await expect(
      service.onDependentEvidenceUploaded({
        dependentUserId: DEPENDENT,
        kind: 'honor',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('GuardianNotificationsService.onConsentVerified', () => {
  it('tells every active guardian but the verifier, with the family consent source', async () => {
    const { service, notifications } = setup(dependentWith([G1, G2]));

    await service.onConsentVerified({
      dependentUserId: DEPENDENT,
      verifierUserId: G2,
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      {
        userId: G1,
        title: 'Ana · consentimiento verificado',
        body: 'El club verificó la ficha de consentimiento firmada.',
        data: {
          type: 'dependent_consent_verified',
          dependent_user_id: DEPENDENT,
        },
      },
      'system',
      'family:consent_verified',
    );
  });

  it('tells the guardians of a linked teen (who holds an account) that consent was verified', async () => {
    const { service, notifications, prisma } = setup(dependentWith([G1]));

    await service.onConsentVerified({
      dependentUserId: DEPENDENT,
      verifierUserId: 'director-1',
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(prisma.users.findFirst.mock.calls[0][0].where).not.toHaveProperty(
      'account',
    );
  });

  it('is a no-op for a dependent that is gone, frozen or purged', async () => {
    const { service, notifications } = setup(null);

    await service.onConsentVerified({
      dependentUserId: DEPENDENT,
      verifierUserId: G2,
    });

    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('is a no-op when only the verifier is a guardian', async () => {
    const { service, notifications } = setup(dependentWith([G1]));

    await service.onConsentVerified({
      dependentUserId: DEPENDENT,
      verifierUserId: G1,
    });

    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('never throws: a failing lookup is logged', async () => {
    const { service, prisma } = setup(null);
    prisma.users.findFirst.mockRejectedValue(new Error('db down'));

    await expect(
      service.onConsentVerified({
        dependentUserId: DEPENDENT,
        verifierUserId: G2,
      }),
    ).resolves.toBeUndefined();
  });
});
