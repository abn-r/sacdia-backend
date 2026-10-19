import {
  AppBadRequestException,
  AppException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { HonorsService } from './honors.service';
import { HonorInstructorProposalsService } from './honor-instructor-proposals.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ANA = '33333333-3333-4333-8333-333333333333';
const LUIS = '44444444-4444-4444-8444-444444444444';
const REVIEWER = '55555555-5555-4555-8555-555555555555';
const FREE_NAME = 'Juan López Ruiz';
const LOCAL_FIELD = 7;

type Row = Record<string, any>;

/**
 * Prisma en memoria con solo lo que usa el servicio. `$transaction` deshace las
 * escrituras si el callback lanza, así los tests ven el rollback de verdad.
 */
function createFakePrisma() {
  const state = {
    honor: {
      user_honor_id: 70,
      user_id: OWNER,
      honor_id: 15,
      active: true,
      validate: true,
      validation_status: 'APPROVED',
      validated_by_id: 'validator-1',
      validated_at: new Date('2026-05-01T00:00:00.000Z'),
      date: new Date('2026-03-01T00:00:00.000Z'),
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      certificate: 'cert.pdf',
      images: ['a.jpg'],
      document: null,
      completion_mode: 'REQUIREMENTS',
      instructor_user_id: null as string | null,
      instructor_name: null as string | null,
      modified_at: new Date('2026-05-01T00:00:00.000Z'),
    } as Row,
    proposals: [] as Row[],
    logs: [] as Row[],
    honorWrites: [] as Row[],
    users: {
      [OWNER]: {
        user_id: OWNER,
        name: 'Marta',
        paternal_last_name: 'Díaz',
        maternal_last_name: null,
        local_field_id: LOCAL_FIELD,
        email: 'marta@example.com',
      },
      [ANA]: {
        user_id: ANA,
        name: 'Ana',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'Gómez',
        local_field_id: LOCAL_FIELD,
        user_image: 'ana.jpg',
      },
      [LUIS]: {
        user_id: LUIS,
        name: 'Luis',
        paternal_last_name: 'Soto',
        maternal_last_name: null,
        local_field_id: LOCAL_FIELD,
        user_image: null,
      },
    } as Record<string, Row>,
    reviewers: {} as Record<string, Row>,
    seq: 0,
    clock: 0,
  };

  const hydrate = (proposal: Row) => ({
    ...proposal,
    instructor: proposal.instructor_user_id
      ? state.users[proposal.instructor_user_id]
      : null,
    user_honor: {
      ...state.honor,
      honors: { honor_id: state.honor.honor_id, name: 'Primeros auxilios' },
      users: state.users[state.honor.user_id],
      instructor: state.honor.instructor_user_id
        ? state.users[state.honor.instructor_user_id]
        : null,
    },
  });

  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in (value as Row)) {
        return (value as Row).in.includes(row[key]);
      }
      return row[key] === value;
    });

  const makeClient = (undo?: Array<() => void>) => {
    const record = (fn: () => void) => undo?.push(fn);
    return {
      users: {
        findUnique: jest.fn(
          async ({ where }: Row) => state.reviewers[where.user_id] ?? null,
        ),
      },
      users_honors: {
        findFirst: jest.fn(async ({ where }: Row) =>
          matches(state.honor, where) ? { ...state.honor } : null,
        ),
        updateMany: jest.fn(async ({ where, data }: Row) => {
          state.honorWrites.push({ where, data });
          if (!matches(state.honor, where)) return { count: 0 };
          const before = { ...state.honor };
          Object.assign(state.honor, data);
          record(() => Object.assign(state.honor, before));
          return { count: 1 };
        }),
      },
      honor_instructor_proposals: {
        findFirst: jest.fn(async ({ where }: Row) => {
          const found = state.proposals.find((p) => matches(p, where));
          return found ? { ...found } : null;
        }),
        findUnique: jest.fn(async ({ where }: Row) => {
          const found = state.proposals.find(
            (p) => p.proposal_id === where.proposal_id,
          );
          return found ? hydrate(found) : null;
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: Row) => {
          const found = state.proposals.find(
            (p) => p.proposal_id === where.proposal_id,
          );
          if (!found) throw new Error('not found');
          return hydrate(found);
        }),
        findMany: jest.fn(async ({ where }: Row) =>
          state.proposals.filter((p) => p.status === where.status).map(hydrate),
        ),
        count: jest.fn(
          async ({ where }: Row) =>
            state.proposals.filter((p) => p.status === where.status).length,
        ),
        create: jest.fn(async ({ data }: Row) => {
          if (
            data.status !== 'WITHDRAWN' &&
            state.proposals.some(
              (p) =>
                p.user_honor_id === data.user_honor_id &&
                p.status === 'PENDING',
            )
          ) {
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
          }
          const row: Row = {
            proposal_id: `prop-${++state.seq}`,
            status: 'PENDING',
            rejection_reason: null,
            reviewed_by_id: null,
            reviewed_at: null,
            instructor_user_id: null,
            instructor_name: null,
            created_at: new Date(Date.UTC(2026, 9, 12, 12, 0, ++state.clock)),
            ...data,
          };
          state.proposals.push(row);
          record(() => state.proposals.splice(state.proposals.indexOf(row), 1));
          return hydrate(row);
        }),
        updateMany: jest.fn(async ({ where, data }: Row) => {
          const found = state.proposals.filter((p) => matches(p, where));
          for (const row of found) {
            const before = { ...row };
            Object.assign(row, data);
            record(() => Object.assign(row, before));
          }
          return { count: found.length };
        }),
      },
      validation_logs: {
        create: jest.fn(async ({ data }: Row) => {
          state.logs.push(data);
          record(() => state.logs.splice(state.logs.indexOf(data), 1));
          return data;
        }),
      },
    };
  };

  const base = makeClient();
  const prisma = {
    ...base,
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => {
      const undo: Array<() => void> = [];
      try {
        return await callback(makeClient(undo));
      } catch (error) {
        undo.reverse().forEach((fn) => fn());
        throw error;
      }
    }),
  };
  return { prisma, state };
}

describe('HonorInstructorProposalsService (B9, D11)', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: HonorInstructorProposalsService;
  let eligible: Set<string>;
  const instructors = {
    assertEligible: jest.fn(),
    photoUrlsFor: jest.fn(),
  };

  const pendingProposal = (extra: Row = {}) => {
    const row: Row = {
      proposal_id: `seed-${fake.state.seq++}`,
      user_honor_id: 70,
      proposed_by_id: OWNER,
      status: 'PENDING',
      instructor_user_id: ANA,
      instructor_name: null,
      rejection_reason: null,
      reviewed_by_id: null,
      reviewed_at: null,
      created_at: new Date('2026-10-12T10:00:00.000Z'),
      ...extra,
    };
    fake.state.proposals.push(row);
    return row;
  };

  const reviewer = (roles: string[], localFieldId: number | null) => {
    fake.state.reviewers[REVIEWER] = {
      local_field_id: localFieldId,
      users_roles: roles.map((role) => ({ roles: { role_name: role } })),
    };
  };

  const fail = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as AppException;
    }
    throw new Error('expected a rejection');
  };
  const expectCode = async (
    promise: Promise<unknown>,
    code: ErrorCode,
    status: number,
  ) => {
    const error = await fail(promise);
    expect(error).toBeInstanceOf(AppException);
    expect(error.code).toBe(code);
    expect(error.getStatus()).toBe(status);
  };

  beforeEach(() => {
    fake = createFakePrisma();
    eligible = new Set([ANA, LUIS]);
    instructors.assertEligible.mockReset();
    instructors.assertEligible.mockImplementation(
      async (owner: string, instructor: string) => {
        if (owner === instructor) {
          throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_SELF);
        }
        if (!eligible.has(instructor)) {
          throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_INVALID);
        }
      },
    );
    instructors.photoUrlsFor.mockReset();
    instructors.photoUrlsFor.mockResolvedValue(
      new Map([[ANA, 'https://signed.example/ana.jpg']]),
    );
    service = new HonorInstructorProposalsService(
      fake.prisma as never,
      instructors as never,
    );
    reviewer(['director-lf'], LOCAL_FIELD);
  });

  describe('propose', () => {
    it('creates a PENDING proposal for a same-field system instructor, validated against the OWNER', async () => {
      const result = await service.propose(OWNER, OWNER, 15, {
        instructorUserId: ANA,
      });

      expect(instructors.assertEligible).toHaveBeenCalledWith(OWNER, ANA);
      expect(result).toEqual({
        proposal_id: 'prop-1',
        status: 'PENDING',
        instructor: {
          kind: 'USER',
          user_id: ANA,
          display_name: 'Ana Pérez Gómez',
          photo_url: 'https://signed.example/ana.jpg',
        },
        rejection_reason: null,
        created_at: expect.any(Date),
        reviewed_at: null,
      });
      expect(fake.state.proposals[0]).toMatchObject({
        user_honor_id: 70,
        proposed_by_id: OWNER,
        instructor_user_id: ANA,
        instructor_name: null,
      });
    });

    it('accepts a free-text instructor and never validates it against users', async () => {
      const result = await service.propose(OWNER, OWNER, 15, {
        instructorName: FREE_NAME,
      });

      expect(instructors.assertEligible).not.toHaveBeenCalled();
      expect(result.instructor).toEqual({
        kind: 'EXTERNAL',
        display_name: FREE_NAME,
      });
      expect(fake.state.proposals[0]).toMatchObject({
        instructor_user_id: null,
        instructor_name: FREE_NAME,
      });
    });

    it('is owner-only: another user, even with permission, gets 403 and nothing is written', async () => {
      await expectCode(
        service.propose(OTHER, OWNER, 15, { instructorUserId: ANA }),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
      await expectCode(
        service.withdraw(OTHER, OWNER, 15),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
      expect(fake.prisma.$transaction).not.toHaveBeenCalled();
      expect(fake.state.proposals).toHaveLength(0);
    });

    it('404 when the member never had that honor', async () => {
      await expectCode(
        service.propose(OWNER, OWNER, 999, { instructorUserId: ANA }),
        ErrorCode.HONOR_USER_HONOR_NOT_FOUND,
        404,
      );
    });

    it.each(['IN_PROGRESS', 'REJECTED', 'PENDING_REVIEW'])(
      'a %s honor answers NOT_APPROVED (the PATCH is the only path there)',
      async (status) => {
        fake.state.honor.validation_status = status;

        await expectCode(
          service.propose(OWNER, OWNER, 15, { instructorUserId: ANA }),
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
          400,
        );
        expect(fake.state.proposals).toHaveLength(0);
      },
    );

    it('an inactive APPROVED honor answers NOT_APPROVED', async () => {
      fake.state.honor.active = false;

      await expectCode(
        service.propose(OWNER, OWNER, 15, { instructorName: FREE_NAME }),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
        400,
      );
    });

    it('REQUIRED when neither is sent (null counts as absent) and AMBIGUOUS when both are', async () => {
      await expectCode(
        service.propose(OWNER, OWNER, 15, {}),
        ErrorCode.HONOR_INSTRUCTOR_REQUIRED,
        400,
      );
      await expectCode(
        service.propose(OWNER, OWNER, 15, {
          instructorUserId: null,
          instructorName: null,
        }),
        ErrorCode.HONOR_INSTRUCTOR_REQUIRED,
        400,
      );
      await expectCode(
        service.propose(OWNER, OWNER, 15, {
          instructorUserId: ANA,
          instructorName: FREE_NAME,
        }),
        ErrorCode.HONOR_INSTRUCTOR_AMBIGUOUS,
        400,
      );
    });

    it('INVALID when the instructor is not eligible and SELF when it is the owner', async () => {
      eligible.delete(ANA);
      await expectCode(
        service.propose(OWNER, OWNER, 15, { instructorUserId: ANA }),
        ErrorCode.HONOR_INSTRUCTOR_INVALID,
        400,
      );
      await expectCode(
        service.propose(OWNER, OWNER, 15, { instructorUserId: OWNER }),
        ErrorCode.HONOR_INSTRUCTOR_SELF,
        400,
      );
      expect(fake.state.proposals).toHaveLength(0);
    });

    it('UNCHANGED when the person is already the current instructor (name compared case-insensitively)', async () => {
      fake.state.honor.instructor_user_id = ANA;
      await expectCode(
        service.propose(OWNER, OWNER, 15, { instructorUserId: ANA }),
        ErrorCode.HONOR_INSTRUCTOR_UNCHANGED,
        400,
      );

      fake.state.honor.instructor_user_id = null;
      fake.state.honor.instructor_name = FREE_NAME;
      await expectCode(
        service.propose(OWNER, OWNER, 15, {
          instructorName: FREE_NAME.toUpperCase(),
        }),
        ErrorCode.HONOR_INSTRUCTOR_UNCHANGED,
        400,
      );
      expect(fake.state.proposals).toHaveLength(0);
    });

    it('replacing leaves exactly one PENDING and WITHDRAWS the previous one in the same transaction', async () => {
      const first = await service.propose(OWNER, OWNER, 15, {
        instructorUserId: ANA,
      });
      const second = await service.propose(OWNER, OWNER, 15, {
        instructorUserId: LUIS,
      });

      const byStatus = (status: string) =>
        fake.state.proposals.filter((p) => p.status === status);
      expect(byStatus('PENDING').map((p) => p.proposal_id)).toEqual([
        second.proposal_id,
      ]);
      expect(byStatus('WITHDRAWN').map((p) => p.proposal_id)).toEqual([
        first.proposal_id,
      ]);
      expect(fake.state.logs[1].comment).toBe(
        JSON.stringify({
          proposal_id: second.proposal_id,
          kind: 'USER',
          replaced_proposal_id: first.proposal_id,
        }),
      );
    });

    it('two simultaneous requests leave a single PENDING; the loser gets 409 and its transaction rolls back', async () => {
      const results = await Promise.allSettled([
        service.propose(OWNER, OWNER, 15, { instructorUserId: ANA }),
        service.propose(OWNER, OWNER, 15, { instructorUserId: LUIS }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(AppException);
      expect(rejected.reason.code).toBe(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
      );
      expect(rejected.reason.getStatus()).toBe(409);
      expect(
        fake.state.proposals.filter((p) => p.status === 'PENDING'),
      ).toHaveLength(1);
      expect(fake.state.logs).toHaveLength(1);
    });

    it('a unique-index violation (P2002) while replacing keeps the old PENDING (rollback) and answers 409', async () => {
      pendingProposal();
      const tx = (
        fake.prisma.$transaction as jest.Mock
      ).getMockImplementation()!;
      (fake.prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (cb) =>
          tx(async (client: any) => {
            client.honor_instructor_proposals.create.mockRejectedValueOnce(
              Object.assign(new Error('unique'), { code: 'P2002' }),
            );
            return cb(client);
          }),
      );

      await expectCode(
        service.propose(OWNER, OWNER, 15, { instructorUserId: LUIS }),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        409,
      );
      expect(fake.state.proposals.map((p) => p.status)).toEqual(['PENDING']);
    });

    it('any other database error is not swallowed as a 409', async () => {
      (fake.prisma.$transaction as jest.Mock).mockRejectedValueOnce(
        new Error('connection lost'),
      );

      await expect(
        service.propose(OWNER, OWNER, 15, { instructorUserId: ANA }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('withdraw', () => {
    it('moves the PENDING proposal to WITHDRAWN and audits it', async () => {
      const seeded = pendingProposal();

      const result = await service.withdraw(OWNER, OWNER, 15);

      expect(result).toMatchObject({
        proposal_id: seeded.proposal_id,
        status: 'WITHDRAWN',
      });
      expect(seeded.status).toBe('WITHDRAWN');
      expect(fake.state.logs).toEqual([
        expect.objectContaining({
          action: 'instructor_withdrawn',
          user_id: OWNER,
          performed_by: OWNER,
          comment: JSON.stringify({ proposal_id: seeded.proposal_id }),
        }),
      ]);
    });

    it('404 NOT_FOUND without a pending proposal (a decided one does not count)', async () => {
      pendingProposal({
        status: 'REJECTED',
        reviewed_by_id: REVIEWER,
        reviewed_at: new Date(),
        rejection_reason: 'no',
      });

      await expectCode(
        service.withdraw(OWNER, OWNER, 15),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_FOUND,
        404,
      );
    });

    it('409 when the Campo Local decided it between the read and the write', async () => {
      const seeded = pendingProposal();
      (fake.prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (cb) => {
          seeded.status = 'APPROVED';
          return cb(fake.prisma);
        },
      );

      await expectCode(
        service.withdraw(OWNER, OWNER, 15),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        409,
      );
    });
  });

  describe('approve', () => {
    it('changes ONLY instructor_* and modified_at on users_honors (row before/after)', async () => {
      const seeded = pendingProposal();
      const before = { ...fake.state.honor };

      await service.approve(REVIEWER, seeded.proposal_id);

      const after = fake.state.honor;
      const changed = Object.keys(after).filter(
        (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
      );
      expect(changed.sort()).toEqual(['instructor_user_id', 'modified_at']);
      expect(after.instructor_user_id).toBe(ANA);
      for (const key of [
        'validation_status',
        'validated_by_id',
        'validated_at',
        'validate',
        'date',
        'completed_at',
        'certificate',
        'images',
        'document',
        'active',
        'completion_mode',
      ]) {
        expect(after[key]).toEqual(before[key]);
      }
      expect(fake.state.honorWrites).toHaveLength(1);
      const written = fake.state.honorWrites[0];
      expect(Object.keys(written.data).sort()).toEqual([
        'instructor_name',
        'instructor_user_id',
        'modified_at',
      ]);
      expect(written.where).toMatchObject({
        active: true,
        validation_status: 'APPROVED',
      });
    });

    it('assigning a user clears the free name and the other way around', async () => {
      fake.state.honor.instructor_name = FREE_NAME;
      const byUser = pendingProposal({
        instructor_user_id: ANA,
        instructor_name: null,
      });
      await service.approve(REVIEWER, byUser.proposal_id);
      expect(fake.state.honor).toMatchObject({
        instructor_user_id: ANA,
        instructor_name: null,
      });

      const byName = pendingProposal({
        proposal_id: 'by-name',
        instructor_user_id: null,
        instructor_name: FREE_NAME,
      });
      await service.approve(REVIEWER, byName.proposal_id);
      expect(fake.state.honor).toMatchObject({
        instructor_user_id: null,
        instructor_name: FREE_NAME,
      });
    });

    it('marks the proposal APPROVED with reviewer and date, and returns the admin item', async () => {
      const seeded = pendingProposal();

      const item = await service.approve(REVIEWER, seeded.proposal_id);

      expect(seeded).toMatchObject({
        status: 'APPROVED',
        reviewed_by_id: REVIEWER,
      });
      expect(seeded.reviewed_at).toBeInstanceOf(Date);
      expect(item).toMatchObject({
        proposal_id: seeded.proposal_id,
        status: 'APPROVED',
        proposed_instructor: {
          kind: 'USER',
          user_id: ANA,
          display_name: 'Ana Pérez Gómez',
        },
        current_instructor: { kind: 'USER', user_id: ANA },
      });
    });

    it('revalidates the instructor: if no longer eligible, 400 INVALID, still PENDING, row untouched', async () => {
      const seeded = pendingProposal();
      const before = { ...fake.state.honor };
      eligible.delete(ANA);

      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_INVALID,
        400,
      );

      expect(instructors.assertEligible).toHaveBeenCalledWith(OWNER, ANA);
      expect(seeded.status).toBe('PENDING');
      expect(fake.state.honor).toEqual(before);
    });

    it('does not revalidate a free-text instructor', async () => {
      const seeded = pendingProposal({
        instructor_user_id: null,
        instructor_name: FREE_NAME,
      });

      await service.approve(REVIEWER, seeded.proposal_id);

      expect(instructors.assertEligible).not.toHaveBeenCalled();
    });

    it('409 when the honor stopped being APPROVED (or inactive): proposal stays PENDING, row untouched', async () => {
      const seeded = pendingProposal();
      for (const mutate of [
        () => (fake.state.honor.validation_status = 'PENDING_REVIEW'),
        () => {
          fake.state.honor.validation_status = 'APPROVED';
          fake.state.honor.active = false;
        },
      ]) {
        mutate();
        const before = { ...fake.state.honor };

        await expectCode(
          service.approve(REVIEWER, seeded.proposal_id),
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
          409,
        );

        expect(seeded.status).toBe('PENDING');
        expect(fake.state.honor).toEqual(before);
      }
    });

    it('409 when the honor changes between the check and the write (conditional update rolls back the decision)', async () => {
      const seeded = pendingProposal();
      (fake.prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (cb) => {
          fake.state.honor.validation_status = 'PENDING_REVIEW';
          return cb(fake.prisma);
        },
      );

      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
        409,
      );
      expect(fake.state.honor.instructor_user_id).toBeNull();
    });

    it('a second approval, or approving a REJECTED / WITHDRAWN proposal, is a 409', async () => {
      const seeded = pendingProposal();
      await service.approve(REVIEWER, seeded.proposal_id);
      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        409,
      );
      for (const status of ['REJECTED', 'WITHDRAWN']) {
        const other = pendingProposal({ proposal_id: `p-${status}`, status });
        await expectCode(
          service.approve(REVIEWER, other.proposal_id),
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
          409,
        );
      }
    });

    it('a decision lost to a concurrent reviewer is a 409 and leaves the row untouched', async () => {
      const seeded = pendingProposal();
      const before = { ...fake.state.honor };
      (fake.prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (cb) => {
          seeded.status = 'REJECTED';
          return cb(fake.prisma);
        },
      );

      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        409,
      );
      expect(fake.state.honor).toEqual(before);
    });

    it('404 for an unknown proposal', async () => {
      await expectCode(
        service.approve(REVIEWER, 'missing'),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_FOUND,
        404,
      );
    });

    it.each([
      ['NONE', null, null],
      ['USER', LUIS, null],
      ['EXTERNAL', null, 'Pedro Gómez Ríos'],
    ])('audits previous_kind %s', async (kind, userId, name) => {
      fake.state.honor.instructor_user_id = userId;
      fake.state.honor.instructor_name = name;
      const seeded = pendingProposal();

      await service.approve(REVIEWER, seeded.proposal_id);

      expect(fake.state.logs).toEqual([
        expect.objectContaining({
          action: 'instructor_approved',
          entity_type: 'honor',
          entity_id: '70',
          user_id: OWNER,
          performed_by: REVIEWER,
          comment: JSON.stringify({
            proposal_id: seeded.proposal_id,
            kind: 'USER',
            previous_kind: kind,
          }),
        }),
      ]);
    });
  });

  describe('reviewer scope', () => {
    it.each([
      ['super-admin', null],
      ['super-admin', 99],
      ['admin', null],
      ['assistant-admin', null],
      ['director-lf', LOCAL_FIELD],
      ['assistant-lf', LOCAL_FIELD],
      ['admin', LOCAL_FIELD],
    ])('%s (local field %s) may decide', async (role, localField) => {
      reviewer([role], localField);
      const seeded = pendingProposal();

      await expect(
        service.approve(REVIEWER, seeded.proposal_id),
      ).resolves.toBeDefined();
    });

    it.each([
      ['director-lf', 99],
      ['assistant-lf', 99],
      ['admin', 99],
    ])(
      '%s of ANOTHER local field gets 403 on approve and reject, nothing written',
      async (role, localField) => {
        reviewer([role], localField);
        const seeded = pendingProposal();
        const before = { ...fake.state.honor };

        await expectCode(
          service.approve(REVIEWER, seeded.proposal_id),
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
          403,
        );
        await expectCode(
          service.reject(REVIEWER, seeded.proposal_id, { reason: 'No aplica' }),
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
          403,
        );
        expect(seeded.status).toBe('PENDING');
        expect(fake.state.honor).toEqual(before);
        expect(fake.state.logs).toHaveLength(0);
      },
    );

    it('the scope is the OWNER local field, not the proposer or the instructor', async () => {
      fake.state.users[OWNER].local_field_id = 99;
      reviewer(['director-lf'], LOCAL_FIELD);
      const seeded = pendingProposal();

      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
    });

    it('a reviewer without a role or without scope gets 403', async () => {
      const seeded = pendingProposal();
      reviewer(['member'], LOCAL_FIELD);
      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
      reviewer(['director-lf'], null);
      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
      delete fake.state.reviewers[REVIEWER];
      await expectCode(
        service.approve(REVIEWER, seeded.proposal_id),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
        403,
      );
    });

    it('the queue is filtered by the reviewer local field, except for global reviewers', async () => {
      const findMany = fake.prisma.honor_instructor_proposals
        .findMany as jest.Mock;

      reviewer(['director-lf'], LOCAL_FIELD);
      await service.list(REVIEWER, {});
      expect(findMany.mock.calls[0][0].where).toEqual({
        status: 'PENDING',
        user_honor: { users: { local_field_id: LOCAL_FIELD } },
      });

      reviewer(['super-admin'], null);
      await service.list(REVIEWER, {});
      expect(findMany.mock.calls[1][0].where).toEqual({ status: 'PENDING' });
    });
  });

  describe('reject', () => {
    it('rejects with the reason, never touches users_honors and audits the reason', async () => {
      const seeded = pendingProposal();
      const before = { ...fake.state.honor };

      const item = await service.reject(REVIEWER, seeded.proposal_id, {
        reason: 'No firmó el certificado',
      });

      expect(seeded).toMatchObject({
        status: 'REJECTED',
        rejection_reason: 'No firmó el certificado',
        reviewed_by_id: REVIEWER,
      });
      expect(item).toMatchObject({
        status: 'REJECTED',
        rejection_reason: 'No firmó el certificado',
      });
      expect(fake.state.honor).toEqual(before);
      expect(fake.state.honorWrites).toHaveLength(0);
      expect(fake.state.logs).toEqual([
        expect.objectContaining({
          action: 'instructor_rejected',
          performed_by: REVIEWER,
          comment: JSON.stringify({
            proposal_id: seeded.proposal_id,
            reason: 'No firmó el certificado',
          }),
        }),
      ]);
    });

    it('409 when it is no longer PENDING', async () => {
      const seeded = pendingProposal({ status: 'APPROVED' });

      await expectCode(
        service.reject(REVIEWER, seeded.proposal_id, { reason: 'Tarde' }),
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        409,
      );
    });

    it('can reject even if the honor is no longer APPROVED (clean-up of the queue)', async () => {
      fake.state.honor.validation_status = 'PENDING_REVIEW';
      const seeded = pendingProposal();

      await expect(
        service.reject(REVIEWER, seeded.proposal_id, {
          reason: 'Ya no aplica',
        }),
      ).resolves.toMatchObject({ status: 'REJECTED' });
    });
  });

  describe('queue', () => {
    it('lists PENDING by default, oldest first, with both instructors and no email nor photo', async () => {
      fake.state.honor.instructor_name = FREE_NAME;
      pendingProposal();

      const result = await service.list(REVIEWER, { page: 1, limit: 20 });

      const args = (
        fake.prisma.honor_instructor_proposals.findMany as jest.Mock
      ).mock.calls[0][0];
      expect(args.where.status).toBe('PENDING');
      expect(args.orderBy).toEqual([
        { created_at: 'asc' },
        { proposal_id: 'asc' },
      ]);
      expect(args.include.instructor.select).not.toHaveProperty('user_image');
      expect(args.include.instructor.select).not.toHaveProperty('email');
      expect(result).toEqual({
        items: [
          {
            proposal_id: 'seed-0',
            status: 'PENDING',
            created_at: new Date('2026-10-12T10:00:00.000Z'),
            honor: { honor_id: 15, name: 'Primeros auxilios' },
            member: { user_id: OWNER, display_name: 'Marta Díaz' },
            current_instructor: { kind: 'EXTERNAL', display_name: FREE_NAME },
            proposed_instructor: {
              kind: 'USER',
              user_id: ANA,
              display_name: 'Ana Pérez Gómez',
            },
            rejection_reason: null,
            reviewed_at: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /email|marta@|ana\.jpg|photo_url/,
      );
    });

    it('filters by the requested status and caps limit at 100', async () => {
      await service.list(REVIEWER, {
        status: 'REJECTED' as never,
        page: 2,
        limit: 500,
      });

      const args = (
        fake.prisma.honor_instructor_proposals.findMany as jest.Mock
      ).mock.calls[0][0];
      expect(args.where.status).toBe('REJECTED');
      expect(args).toMatchObject({ skip: 100, take: 100 });
    });
  });

  describe('audit trail', () => {
    it('uses the four documented actions (<= 20 chars) and never stores the free-text name', async () => {
      const proposed = await service.propose(OWNER, OWNER, 15, {
        instructorName: FREE_NAME,
      });
      await service.withdraw(OWNER, OWNER, 15);
      const again = await service.propose(OWNER, OWNER, 15, {
        instructorName: FREE_NAME,
      });
      await service.approve(REVIEWER, again.proposal_id);
      const third = await service.propose(OWNER, OWNER, 15, {
        instructorUserId: ANA,
      });
      await service.reject(REVIEWER, third.proposal_id, {
        reason: 'No coincide',
      });

      expect(proposed.proposal_id).toBeDefined();
      const actions = fake.state.logs.map((log) => log.action);
      expect(actions).toEqual([
        'instructor_proposed',
        'instructor_withdrawn',
        'instructor_proposed',
        'instructor_approved',
        'instructor_proposed',
        'instructor_rejected',
      ]);
      for (const log of fake.state.logs) {
        expect(log.action.length).toBeLessThanOrEqual(20);
        expect(log.entity_type).toBe('honor');
        expect(log.entity_type.length).toBeLessThanOrEqual(20);
        expect(JSON.stringify(log)).not.toContain(FREE_NAME);
        expect(JSON.stringify(log)).not.toContain('López');
      }
    });
  });

  describe('coexistence with assertHonorIsMutable', () => {
    it('on an APPROVED honor the proposal goes through while the PATCH with instructorUserId stays blocked', async () => {
      const honors = new HonorsService(
        fake.prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        instructors as never,
        {} as never,
      );

      const patch = await fail(
        honors.updateUserHonor(OWNER, 15, { instructorUserId: ANA }),
      );
      const proposal = await service.propose(OWNER, OWNER, 15, {
        instructorUserId: ANA,
      });
      const patchAgain = await fail(
        honors.updateUserHonor(OWNER, 15, { instructorName: FREE_NAME }),
      );

      expect(proposal.status).toBe('PENDING');
      for (const error of [patch, patchAgain]) {
        expect(error.code).toBe(ErrorCode.VALIDATION_HONOR_INVALID_STATUS);
        expect(error.getStatus()).toBe(400);
      }
      // El PATCH nunca escribió nada; la propuesta tampoco toca la fila hasta aprobar.
      expect(fake.state.honor.instructor_user_id).toBeNull();
      expect(fake.state.honor.instructor_name).toBeNull();
    });
  });
});
