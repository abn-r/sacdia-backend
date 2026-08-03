import { EcclesiasticalCycleRunService } from './ecclesiastical-cycle-run.service';

const input = { actorUserId: 'actor', localFieldId: 1, targetYearId: 2027 };
const runId = '00000000-0000-0000-0000-000000000010';

const preflight = {
  execute: jest.fn(async () => ({
    capabilities: {
      p0: { available: true, version: 1 },
      progression: { available: true, version: 1 },
      masterGuide: { available: true, version: 1 },
    },
    summary: { total: 3, ready: 1, pendingChoice: 1, blocked: 1 },
    cases: [
      {
        state: 'ready',
        userId: 'user-1',
        sourceEnrollmentId: 10,
        sourceAssignmentId: 'assignment-1',
        targetClassId: 20,
        targetClubSectionId: 30,
        canonicalTransitionId: 40,
        reasons: [],
      },
      {
        state: 'pending_choice',
        userId: 'user-2',
        sourceEnrollmentId: 11,
        sourceAssignmentId: 'assignment-2',
        targetClassId: 21,
        canonicalTransitionId: null,
        reasons: ['DESTINATION_CURRENT_CLUB_MISSING'],
      },
      {
        state: 'blocked',
        userId: 'user-3',
        sourceEnrollmentId: 12,
        reasons: ['MEMBERSHIP_MISSING'],
      },
    ],
  })),
};

const transaction = {
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(async () => [{ now: new Date('2027-01-01T00:00:00Z') }]),
  ecclesiastical_cycle_runs: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ecclesiastical_cycle_decisions: { upsert: jest.fn() },
  ecclesiastical_cycle_events: { createMany: jest.fn() },
};
const prisma = {
  $transaction: jest.fn(async (callback) => callback(transaction)),
};

describe('EcclesiasticalCycleRunService', () => {
  const service = new EcclesiasticalCycleRunService(
    prisma as never,
    preflight as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.ecclesiastical_cycle_runs.findUnique.mockResolvedValue(null);
    transaction.ecclesiastical_cycle_runs.create.mockResolvedValue({
      run_id: runId,
    });
    transaction.ecclesiastical_cycle_runs.update.mockResolvedValue({
      run_id: runId,
    });
    transaction.ecclesiastical_cycle_decisions.upsert
      .mockResolvedValueOnce({ decision_id: 'decision-1' })
      .mockResolvedValueOnce({ decision_id: 'decision-2' });
  });

  it('serializes planning, leases the run, journals it, and plans only identifiable cases', async () => {
    await expect(service.plan(input)).resolves.toEqual({
      disposition: 'planned',
      runId,
      decisions: 2,
      skipped: 1,
    });

    expect(transaction.$executeRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        strings: expect.arrayContaining([
          expect.stringContaining('pg_advisory_xact_lock(hashtextextended('),
        ]),
      }),
    );
    expect(transaction.ecclesiastical_cycle_runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'running',
          lease_token: expect.any(String),
        }),
      }),
    );
    expect(
      transaction.ecclesiastical_cycle_decisions.upsert,
    ).toHaveBeenCalledTimes(2);
    expect(
      transaction.ecclesiastical_cycle_events.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({ event_type: 'RUN_STARTED' }),
          expect.objectContaining({ event_type: 'DECISION_PLANNED' }),
          expect.objectContaining({ event_type: 'RUN_COMPLETED' }),
        ]),
      }),
    );
    expect(
      transaction.ecclesiastical_cycle_runs.update,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          lease_token: null,
          lease_expires_at: null,
        }),
      }),
    );
  });

  it('returns a no-op receipt for an already completed run', async () => {
    transaction.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({
      run_id: runId,
      status: 'completed',
      lease_expires_at: null,
    });
    await expect(service.plan(input)).resolves.toEqual({
      disposition: 'replayed',
      runId,
    });
    expect(
      transaction.ecclesiastical_cycle_decisions.upsert,
    ).not.toHaveBeenCalled();
    expect(
      transaction.ecclesiastical_cycle_events.createMany,
    ).not.toHaveBeenCalled();
  });

  it('does not reclaim an unexpired lease after acquiring the transaction lock', async () => {
    transaction.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({
      run_id: runId,
      status: 'running',
      lease_expires_at: new Date('2027-01-01T00:05:00Z'),
    });
    await expect(service.plan(input)).resolves.toEqual({
      disposition: 'leased',
      runId,
    });
    expect(transaction.ecclesiastical_cycle_runs.update).not.toHaveBeenCalled();
  });
});
