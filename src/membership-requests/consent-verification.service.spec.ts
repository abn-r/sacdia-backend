import { Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ConsentVerificationService } from './consent-verification.service';

const SECTION = 12;
const ASSIGNMENT = 'cccccccc-0000-4000-8000-000000000001';
const DEPENDENT = 'dddddddd-0000-4000-8000-000000000001';
const GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND_GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000002';
const DIRECTOR = 'eeeeeeee-0000-4000-8000-000000000001';
const DEPUTY = 'eeeeeeee-0000-4000-8000-000000000002';
const CREATOR = 'ffffffff-0000-4000-8000-000000000001';
const ROW = 'bbbbbbbb-0000-4000-8000-000000000001';

const pendingAssignment = {
  assignment_id: ASSIGNMENT,
  club_section_id: SECTION,
  user_id: DEPENDENT,
  status: 'pending',
  active: true,
};

function primaryRow(overrides: Record<string, unknown> = {}) {
  return {
    guardianship_id: ROW,
    dependent_user_id: DEPENDENT,
    guardian_user_id: GUARDIAN,
    is_custodian: false,
    consent_status: 'pending',
    verification_method: null,
    verified_at: null,
    verified_by_user_id: null,
    consent_evidences: [
      { evidence_id: 'ev-1', uploaded_by_user_id: GUARDIAN },
    ] as Array<{ evidence_id: string; uploaded_by_user_id: string }>,
    dependent: { dependent_profile: { created_by_user_id: GUARDIAN } },
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a rejection');
}

function setup() {
  const order: string[] = [];
  let row: ReturnType<typeof primaryRow> | null = primaryRow();
  let assignment: Record<string, unknown> | null = { ...pendingAssignment };
  let handedOver: { guardian_user_id: string } | null = null;
  const invitees = new Map<
    string,
    Array<{ guardianship_id: string; guardian_user_id: string }>
  >();

  const tx: any = {
    $executeRaw: jest.fn().mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(1);
    }),
    club_role_assignments: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(assignment)),
      findUnique: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...assignment, status: 'active' }),
        ),
    },
    dependent_profiles: {
      findUnique: jest.fn().mockResolvedValue({ user_id: DEPENDENT }),
    },
    guardianships: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        order.push(
          where.is_primary === true ? 'read-primary' : 'read-handover',
        );
        return Promise.resolve(where.is_primary === true ? row : handedOver);
      }),
      updateMany: jest.fn().mockImplementation(() => {
        order.push('verify-update');
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(invitees.get(where.invited_by_guardianship_id) ?? []),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    audit_logs: {
      create: jest.fn().mockImplementation(() => {
        order.push('audit');
        return Promise.resolve({});
      }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: (client: unknown) => unknown) => {
      const result = await cb(tx);
      order.push('commit');
      return result;
    }),
  };
  const actingCache: any = {
    bump: jest.fn().mockImplementation(() => {
      order.push('bump');
      return Promise.resolve();
    }),
  };
  const membershipRequests: any = {
    approve: jest.fn().mockImplementation(() => {
      order.push('approve');
      return Promise.resolve({ assignment_id: ASSIGNMENT, status: 'active' });
    }),
  };
  const notifications: any = {
    onConsentVerified: jest.fn().mockImplementation(() => {
      order.push('notify');
      return Promise.resolve();
    }),
  };
  const service = new ConsentVerificationService(
    prisma,
    actingCache,
    membershipRequests,
    notifications,
  );
  return {
    service,
    tx,
    prisma,
    actingCache,
    membershipRequests,
    notifications,
    order,
    setRow: (value: typeof row) => (row = value),
    setAssignment: (value: typeof assignment) => (assignment = value),
    setHandedOver: (value: typeof handedOver) => (handedOver = value),
    invitees,
  };
}

const dto = (overrides: Record<string, unknown> = {}) =>
  ({ confirm_paper_form_reviewed: true, approve: true, ...overrides }) as any;

describe('ConsentVerificationService.verify', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('happy path', () => {
    it('verifies the primary row in one transaction, then bumps the epoch, notifies and approves', async () => {
      const s = setup();

      const result = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(s.tx.guardianships.updateMany).toHaveBeenCalledWith({
        where: { guardianship_id: ROW, consent_status: 'pending' },
        data: {
          consent_status: 'verified',
          verified_by_user_id: DIRECTOR,
          verified_at: expect.any(Date),
          verification_method: 'director_paper_form',
          modified_at: expect.any(Date),
        },
      });
      // Lock before the first guardianship read; audit inside the transaction;
      // side effects only after commit.
      expect(s.order).toEqual([
        'lock',
        'read-primary',
        'verify-update',
        'audit',
        'commit',
        'bump',
        'notify',
        'approve',
      ]);
      expect(s.actingCache.bump).toHaveBeenCalledWith(DEPENDENT);
      expect(s.notifications.onConsentVerified).toHaveBeenCalledWith({
        dependentUserId: DEPENDENT,
        verifierUserId: DIRECTOR,
      });
      expect(s.membershipRequests.approve).toHaveBeenCalledWith(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
      );
      expect(result).toEqual({
        guardianship: {
          guardianship_id: ROW,
          consent_status: 'verified',
          verified_at: expect.any(String),
          verified_by_user_id: DIRECTOR,
          verification_method: 'director_paper_form',
        },
        assignment: { assignment_id: ASSIGNMENT, status: 'active' },
        approve_error: null,
      });
    });

    it('selects the active, non-test PRIMARY row of the dependent', async () => {
      const s = setup();

      await s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto());

      expect(s.tx.guardianships.findFirst.mock.calls[0][0].where).toEqual({
        dependent_user_id: DEPENDENT,
        is_primary: true,
        is_test_data: false,
        consent_status: { not: 'revoked' },
      });
    });

    it('writes the audit row guardianship.consent_verified with the real actor, in the transaction', async () => {
      const s = setup();

      await s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto());

      expect(s.tx.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'guardianship',
          entity_id: ROW,
          action: 'consent_verified',
          actor_user_id: DIRECTOR,
          actor_kind: 'user',
          target_user_id: DEPENDENT,
          result: 'succeeded',
          source: 'service',
          changes: expect.objectContaining({
            verification_method: 'director_paper_form',
            evidence_id: 'ev-1',
            club_section_id: SECTION,
            assignment_id: ASSIGNMENT,
            custody: false,
            promoted_guardianship_ids: [],
          }),
        }),
      });
    });

    it('approve=false verifies only: no approval, assignment null', async () => {
      const s = setup();

      const result = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto({ approve: false }),
      );

      expect(s.membershipRequests.approve).not.toHaveBeenCalled();
      expect(result.assignment).toBeNull();
      expect(result.guardianship.consent_status).toBe('verified');
    });

    it('approve omitted behaves like approve=false', async () => {
      const s = setup();

      await s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, {
        confirm_paper_form_reviewed: true,
      });

      expect(s.membershipRequests.approve).not.toHaveBeenCalled();
    });
  });

  describe('rejections write nothing', () => {
    const untouched = (s: ReturnType<typeof setup>) => {
      expect(s.tx.guardianships.updateMany).not.toHaveBeenCalled();
      expect(s.tx.guardianships.update).not.toHaveBeenCalled();
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.notifications.onConsentVerified).not.toHaveBeenCalled();
      expect(s.membershipRequests.approve).not.toHaveBeenCalled();
    };

    it('confirm_paper_form_reviewed=false is a 400 before anything is read', async () => {
      const s = setup();

      const error = await rejection(
        s.service.verify(
          SECTION,
          ASSIGNMENT,
          DIRECTOR,
          dto({ confirm_paper_form_reviewed: false }),
        ),
      );

      expect(error.code).toBe(ErrorCode.MR_CONSENT_CONFIRMATION_REQUIRED);
      expect(error.getStatus()).toBe(400);
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      untouched(s);
    });

    it('no current signed form: 409 GUARDIANSHIP_EVIDENCE_REQUIRED', async () => {
      const s = setup();
      s.setRow(primaryRow({ consent_evidences: [] }));

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_EVIDENCE_REQUIRED);
      expect(error.getStatus()).toBe(409);
      untouched(s);
    });

    it('a request of another section or a missing one: 404 MR_NOT_FOUND', async () => {
      const s = setup();
      s.setAssignment(null);

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.MR_NOT_FOUND);
      expect(error.getStatus()).toBe(404);
      expect(s.tx.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: ASSIGNMENT, club_section_id: SECTION },
        }),
      );
      untouched(s);
    });

    it('an inactive assignment is a 404 as well', async () => {
      const s = setup();
      s.setAssignment({ ...pendingAssignment, active: false });

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.MR_NOT_FOUND);
      untouched(s);
    });

    it('an adult has no guardian consent to verify: 404 GUARDIANSHIP_NOT_FOUND', async () => {
      const s = setup();
      s.tx.dependent_profiles.findUnique.mockResolvedValue(null);

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      untouched(s);
    });

    it('no active primary holder (everybody left): 404, no orphan verified row', async () => {
      const s = setup();
      s.setRow(null);

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      untouched(s);
    });

    it.each(['rejected', 'expired', 'cancelled'])(
      'a %s request is the usual 409 MR_ALREADY_PENDING',
      async (status) => {
        const s = setup();
        s.setAssignment({ ...pendingAssignment, status });

        const error = await rejection(
          s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
        );

        expect(error.code).toBe(ErrorCode.MR_ALREADY_PENDING);
        expect(error.getStatus()).toBe(409);
        untouched(s);
      },
    );

    it('a concurrent change between read and write (count 0) is a 409 and nothing else is written', async () => {
      const s = setup();
      s.tx.guardianships.updateMany.mockResolvedValue({ count: 0 });

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.MR_ALREADY_PENDING);
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
    });
  });

  describe('idempotent', () => {
    it('already verified (the earlier approve failed): no new audit, no promotion, no bump, no notification; approve is retried', async () => {
      const s = setup();
      s.setRow(
        primaryRow({
          consent_status: 'verified',
          verified_at: new Date('2026-10-18T10:00:00.000Z'),
          verified_by_user_id: DIRECTOR,
          verification_method: 'director_paper_form',
        }),
      );

      const result = await s.service.verify(SECTION, ASSIGNMENT, DEPUTY, dto());

      expect(s.tx.guardianships.updateMany).not.toHaveBeenCalled();
      expect(s.tx.guardianships.findMany).not.toHaveBeenCalled();
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.notifications.onConsentVerified).not.toHaveBeenCalled();
      expect(s.membershipRequests.approve).toHaveBeenCalledTimes(1);
      expect(result.guardianship).toEqual({
        guardianship_id: ROW,
        consent_status: 'verified',
        verified_at: '2026-10-18T10:00:00.000Z',
        verified_by_user_id: DIRECTOR,
        verification_method: 'director_paper_form',
      });
      expect(result.assignment).not.toBeNull();
    });

    it('a double click on a request the first call already approved is a 200 with no side effects', async () => {
      const s = setup();
      s.setAssignment({ ...pendingAssignment, status: 'active' });
      s.setRow(
        primaryRow({
          consent_status: 'verified',
          verified_at: new Date('2026-10-18T10:00:00.000Z'),
          verified_by_user_id: DIRECTOR,
          verification_method: 'director_paper_form',
        }),
      );

      const result = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(result.guardianship.consent_status).toBe('verified');
      expect(result.assignment).toMatchObject({ status: 'active' });
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.membershipRequests.approve).not.toHaveBeenCalled();
    });
  });

  describe('approve() failing AFTER the commit', () => {
    it('keeps the consent verified, reports the code, and a retry succeeds', async () => {
      const s = setup();
      s.membershipRequests.approve.mockRejectedValueOnce(
        new AppException(ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED, 403),
      );

      const first = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(first.guardianship.consent_status).toBe('verified');
      expect(first.assignment).toBeNull();
      expect(first.approve_error).toBe(
        ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
      );
      // The verification already committed and the guardian's scopes expanded.
      expect(s.actingCache.bump).toHaveBeenCalledWith(DEPENDENT);

      // Retry: the row is verified now, only the approval runs.
      s.setRow(
        primaryRow({
          consent_status: 'verified',
          verified_at: new Date(first.guardianship.verified_at),
          verified_by_user_id: DIRECTOR,
          verification_method: 'director_paper_form',
        }),
      );
      s.actingCache.bump.mockClear();
      s.tx.audit_logs.create.mockClear();

      const retry = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(retry.approve_error).toBeNull();
      expect(retry.assignment).toMatchObject({ status: 'active' });
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
    });

    it('an unexpected error while approving is reported as INTERNAL_SERVER_ERROR, never thrown', async () => {
      const s = setup();
      s.membershipRequests.approve.mockRejectedValueOnce(new Error('boom'));

      const result = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(result.guardianship.consent_status).toBe('verified');
      expect(result.approve_error).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    });
  });

  describe('invited guardians', () => {
    it('promotes pending invitees to verified (guardian_invite), transitively, in the same transaction', async () => {
      const s = setup();
      s.invitees.set(ROW, [
        { guardianship_id: 'inv-1', guardian_user_id: SECOND_GUARDIAN },
      ]);
      s.invitees.set('inv-1', [
        { guardianship_id: 'inv-2', guardian_user_id: 'third-guardian' },
      ]);

      await s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto());

      expect(s.tx.guardianships.update).toHaveBeenNthCalledWith(1, {
        where: { guardianship_id: 'inv-1' },
        data: expect.objectContaining({
          consent_status: 'verified',
          verification_method: 'guardian_invite',
          verified_by_user_id: GUARDIAN,
        }),
      });
      expect(s.tx.guardianships.update).toHaveBeenNthCalledWith(2, {
        where: { guardianship_id: 'inv-2' },
        data: expect.objectContaining({
          verification_method: 'guardian_invite',
          verified_by_user_id: SECOND_GUARDIAN,
        }),
      });
      expect(s.tx.guardianships.findMany).toHaveBeenCalledWith({
        where: {
          invited_by_guardianship_id: ROW,
          consent_status: 'pending',
          is_test_data: false,
        },
        select: { guardianship_id: true, guardian_user_id: true },
      });
      // Promotion happens before the commit, audit lists them.
      expect(s.order.indexOf('commit')).toBeGreaterThan(-1);
      expect(
        s.tx.audit_logs.create.mock.calls[0][0].data.changes,
      ).toMatchObject({ promoted_guardianship_ids: ['inv-1', 'inv-2'] });
    });
  });

  describe('custody four-eyes (ruling A14)', () => {
    const custodyRow = (uploader: string) =>
      primaryRow({
        guardian_user_id: null,
        is_custodian: true,
        consent_evidences: [
          { evidence_id: 'ev-9', uploaded_by_user_id: uploader },
        ],
        dependent: { dependent_profile: { created_by_user_id: CREATOR } },
      });

    const expectNothingVerified = (s: ReturnType<typeof setup>) => {
      expect(s.tx.guardianships.updateMany).not.toHaveBeenCalled();
      expect(s.tx.audit_logs.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.membershipRequests.approve).not.toHaveBeenCalled();
    };

    it('the person who uploaded the current form cannot verify the custody: 403', async () => {
      const s = setup();
      s.setRow(custodyRow(DIRECTOR));

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, DIRECTOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_CUSTODIAN_SELF_VERIFY);
      expect(error.getStatus()).toBe(403);
      expectNothingVerified(s);
    });

    it('the creator of the dependent cannot verify the custody: 403', async () => {
      const s = setup();
      s.setRow(custodyRow(DEPUTY));

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, CREATOR, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_CUSTODIAN_SELF_VERIFY);
      expectNothingVerified(s);
    });

    it('the guardian who handed the child over to the club cannot verify the custody: 403', async () => {
      const s = setup();
      s.setRow(custodyRow(DEPUTY));
      s.setHandedOver({ guardian_user_id: GUARDIAN });

      const error = await rejection(
        s.service.verify(SECTION, ASSIGNMENT, GUARDIAN, dto()),
      );

      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_CUSTODIAN_SELF_VERIFY);
      expect(s.tx.guardianships.findFirst).toHaveBeenCalledWith({
        where: {
          dependent_user_id: DEPENDENT,
          is_custodian: false,
          guardian_user_id: { not: null },
          consent_status: 'revoked',
          revoked_reason: { in: ['guardian_left', 'guardian_account_closed'] },
        },
        orderBy: { revoked_at: 'desc' },
        select: { guardian_user_id: true },
      });
      expectNothingVerified(s);
    });

    it('another authorized person of the club verifies the custody (the uploader was someone else)', async () => {
      const s = setup();
      s.setRow(custodyRow(DIRECTOR));
      s.setHandedOver({ guardian_user_id: GUARDIAN });

      const result = await s.service.verify(SECTION, ASSIGNMENT, DEPUTY, dto());

      expect(result.guardianship.verified_by_user_id).toBe(DEPUTY);
      expect(
        s.tx.audit_logs.create.mock.calls[0][0].data.changes,
      ).toMatchObject({ custody: true });
      expect(s.actingCache.bump).toHaveBeenCalledWith(DEPENDENT);
    });

    it('the rule only applies to custody rows: a guardian row can be verified by whoever uploaded the form', async () => {
      const s = setup();
      s.setRow(
        primaryRow({
          consent_evidences: [
            { evidence_id: 'ev-1', uploaded_by_user_id: DIRECTOR },
          ],
        }),
      );

      const result = await s.service.verify(
        SECTION,
        ASSIGNMENT,
        DIRECTOR,
        dto(),
      );

      expect(result.guardianship.consent_status).toBe('verified');
    });
  });
});
