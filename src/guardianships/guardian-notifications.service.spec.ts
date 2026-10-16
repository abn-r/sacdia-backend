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

  it('is a no-op when the target is not a dependent (or is frozen / has an account)', async () => {
    const { service, notifications, prisma } = setup(null);
    await service.onDependentEvidenceUploaded({
      dependentUserId: DEPENDENT,
      kind: 'honor',
    });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(prisma.users.findFirst.mock.calls[0][0].where).toMatchObject({
      user_id: DEPENDENT,
      active: true,
      account: { none: {} },
      dependent_profile: { is: { frozen_at: null, purged_at: null } },
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
