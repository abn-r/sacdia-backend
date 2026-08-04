import { createHash } from 'node:crypto';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  DirectorSuccessionPlansService,
  type ScheduleDirectorSuccessionInput,
} from './director-succession-plans.service';

const actorId = '00000000-0000-0000-0000-0000000000a1';
const successorId = '00000000-0000-0000-0000-0000000000b2';
const outgoingId = '00000000-0000-0000-0000-0000000000c3';
const sectionId = 11;
const yearId = 2027;
const localFieldId = 9;
const idempotencyKey = 'sched-key-1';

function hashPayload(input: {
  clubSectionId: number;
  outgoingAssignmentId: string;
  successorUserId: string;
  targetEcclesiasticalYearId: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        clubSectionId: input.clubSectionId,
        outgoingAssignmentId: input.outgoingAssignmentId,
        successorUserId: input.successorUserId,
        targetEcclesiasticalYearId: input.targetEcclesiasticalYearId,
      }),
    )
    .digest('hex');
}

describe('DirectorSuccessionPlansService', () => {
  const findFirst = jest.fn();
  const create = jest.fn();
  const clubRoleCreate = jest.fn();
  const clubRoleUpdate = jest.fn();
  const yearFindUnique = jest.fn();
  const tx = {
    director_succession_plans: { findFirst, create },
    club_role_assignments: { create: clubRoleCreate, update: clubRoleUpdate },
    ecclesiastical_years: { findUnique: yearFindUnique },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    director_succession_plans: { findFirst },
  };

  const service = new DirectorSuccessionPlansService(prisma as never);

  const baseInput: ScheduleDirectorSuccessionInput = {
    clubSectionId: sectionId,
    outgoingAssignmentId: outgoingId,
    successorUserId: successorId,
    targetEcclesiasticalYearId: yearId,
    scheduledById: actorId,
    scheduledByRole: 'director-lf',
    scheduledLocalFieldId: localFieldId,
    idempotencyKey,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    yearFindUnique.mockResolvedValue({
      year_id: yearId,
      start_date: new Date('2027-01-01T00:00:00.000Z'),
    });
  });

  it('SCHED-A: repeated schedule with same key and payload returns the same plan without creating again', async () => {
    const requestHash = hashPayload(baseInput);
    const existing = {
      succession_id: '00000000-0000-0000-0000-0000000000d4',
      club_section_id: sectionId,
      outgoing_assignment_id: outgoingId,
      successor_user_id: successorId,
      target_ecclesiastical_year_id: yearId,
      status: 'scheduled',
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      scheduled_by_id: actorId,
    };
    findFirst.mockResolvedValue(existing);

    const first = await service.schedule(baseInput);
    const second = await service.schedule(baseInput);

    expect(first).toEqual(existing);
    expect(second).toEqual(existing);
    expect(create).not.toHaveBeenCalled();
    expect(clubRoleCreate).not.toHaveBeenCalled();
    expect(clubRoleUpdate).not.toHaveBeenCalled();
  });

  it('SCHED-B: same key with a different payload fails closed as IDEMPOTENCY_KEY_REUSED', async () => {
    const requestHash = hashPayload(baseInput);
    findFirst.mockResolvedValue({
      succession_id: '00000000-0000-0000-0000-0000000000d4',
      request_hash: requestHash,
      idempotency_key: idempotencyKey,
      scheduled_by_id: actorId,
    });

    await expect(
      service.schedule({
        ...baseInput,
        successorUserId: '00000000-0000-0000-0000-0000000000ee',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
    } satisfies Partial<AppConflictException>);
    expect(create).not.toHaveBeenCalled();
    expect(clubRoleCreate).not.toHaveBeenCalled();
  });

  it('SCHED-C: read returns the plan without mutating role assignments', async () => {
    const plan = {
      succession_id: '00000000-0000-0000-0000-0000000000d4',
      club_section_id: sectionId,
      status: 'scheduled',
    };
    findFirst.mockResolvedValue(plan);

    await expect(service.getBySection(sectionId)).resolves.toEqual(plan);
    expect(create).not.toHaveBeenCalled();
    expect(clubRoleCreate).not.toHaveBeenCalled();
    expect(clubRoleUpdate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
