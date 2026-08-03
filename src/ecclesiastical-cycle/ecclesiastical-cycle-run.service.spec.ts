import { EcclesiasticalCycleRunService } from './ecclesiastical-cycle-run.service';

const input = { actorUserId: 'actor', localFieldId: 1, targetYearId: 2027 };
const runId = '00000000-0000-0000-0000-000000000010';
// prettier-ignore
const capabilities = { p0: { available: true, version: 1 }, progression: { available: true, version: 1 }, masterGuide: { available: true, version: 1 } };
// prettier-ignore
const cases = () => [{ state: 'ready', userId: 'user-1', sourceEnrollmentId: 10, sourceAssignmentId: 'assignment-1', targetClassId: 20, targetClubSectionId: 30, canonicalTransitionId: 40, reasons: [] }, { state: 'pending_choice', userId: 'user-2', sourceEnrollmentId: 11, sourceAssignmentId: 'assignment-2', targetClassId: 21, canonicalTransitionId: null, reasons: ['DESTINATION_CURRENT_CLUB_MISSING'] }];
// prettier-ignore
const plan = (overrides = {}) => ({ capabilities, reasons: [], summary: { total: 2, ready: 1, pendingChoice: 1, blocked: 0 }, cases: cases(), ...overrides });
// prettier-ignore
const record = (id: string, user: string, assignment: string, enrollment: number, extra = {}) => ({ decision_id: id, run_id: runId, user_id: user, source_assignment_id: assignment, source_enrollment_id: enrollment, target_year_id: 2027, canonical_transition_id: null, target_class_id: 21, target_club_section_id: null, status: 'pending_choice', reason_code: 'DESTINATION_CURRENT_CLUB_MISSING', actor_user_id: 'actor', effect_refs: [], ...extra });
// prettier-ignore
const records = () => [record('decision-1', 'user-1', 'assignment-1', 10, { canonical_transition_id: 40, target_class_id: 20, target_club_section_id: 30, status: 'planned', reason_code: null }), record('decision-2', 'user-2', 'assignment-2', 11)];

const tx = {
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(async () => [{ now: new Date('2027-01-01T00:00:00Z') }]),
  ecclesiastical_cycle_runs: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ecclesiastical_cycle_decisions: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  ecclesiastical_cycle_events: { findMany: jest.fn(), createMany: jest.fn() },
};
const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
const preflight = { execute: jest.fn(async () => plan()) };

describe('EcclesiasticalCycleRunService', () => {
  const service = new EcclesiasticalCycleRunService(
    prisma as never,
    preflight as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue(null);
    tx.ecclesiastical_cycle_runs.create.mockResolvedValue({ run_id: runId });
    tx.ecclesiastical_cycle_runs.update.mockResolvedValue({ run_id: runId });
    tx.ecclesiastical_cycle_decisions.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(records());
    tx.ecclesiastical_cycle_events.findMany.mockResolvedValue([]);
  });

  it('locks before exact preflight, batches deterministic decisions, and journals completion', async () => {
    await expect(service.plan(input)).resolves.toEqual({
      disposition: 'planned',
      runId,
      decisions: 2,
      skipped: 0,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 20_000,
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      preflight.execute.mock.invocationCallOrder[0],
    );
    expect(tx.ecclesiastical_cycle_decisions.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: records().map(
          ({ decision_id: _decisionId, ...decision }) => decision,
        ),
      }),
    );
    expect(tx.ecclesiastical_cycle_events.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ event_type: 'RUN_STARTED' }),
          expect.objectContaining({
            event_type: 'DECISION_PLANNED',
            payload: { hash: expect.any(String) },
          }),
          expect.objectContaining({ event_type: 'RUN_COMPLETED' }),
        ]),
      }),
    );
    expect(tx.ecclesiastical_cycle_runs.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          lease_token: null,
        }),
      }),
    );
  });

  it('replays only the matching durable snapshot, decisions, and journal', async () => {
    // prettier-ignore
    const replay = { ...plan(), summary: { total: 0, ready: 0, pendingChoice: 0, blocked: 0 }, cases: [] };
    const replaySnapshot = { request: input, preflight: replay };
    preflight.execute.mockReset().mockResolvedValue(replay);
    // prettier-ignore
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'completed', summary: replaySnapshot });
    tx.ecclesiastical_cycle_decisions.findMany
      .mockReset()
      .mockResolvedValue([]);
    // prettier-ignore
    tx.ecclesiastical_cycle_events.findMany.mockReset().mockResolvedValue([{ run_id: runId, decision_id: null, event_key: `run.${runId}.started`, event_type: 'RUN_STARTED', actor_user_id: 'actor', payload: { snapshot: replaySnapshot } }, { run_id: runId, decision_id: null, event_key: `run.${runId}.completed`, event_type: 'RUN_COMPLETED', actor_user_id: 'actor', payload: { snapshot: replaySnapshot } }]);
    await expect(service.plan(input)).resolves.toEqual({
      disposition: 'replayed',
      runId,
    });
    expect(tx.ecclesiastical_cycle_decisions.createMany).not.toHaveBeenCalled();
    expect(tx.ecclesiastical_cycle_events.createMany).not.toHaveBeenCalled();
  });

  it('persists a retryable global preflight block and never completes it', async () => {
    preflight.execute.mockResolvedValueOnce({
      ...plan(),
      reasons: ['TIMEZONE_MISSING'],
      summary: { total: 0, ready: 0, pendingChoice: 0, blocked: 0 },
      cases: [],
    });
    await expect(service.plan(input)).resolves.toMatchObject({
      disposition: 'blocked',
      runId,
      retryable: true,
    });
    expect(tx.ecclesiastical_cycle_events.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ event_type: 'RUN_BLOCKED' })],
      }),
    );
    expect(tx.ecclesiastical_cycle_runs.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'blocked', lease_token: null }),
      }),
    );
  });

  it('rejects mismatched completed or expired durable state before writes', async () => {
    for (const status of ['completed', 'running'] as const) {
      tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValueOnce({
        run_id: runId,
        status,
        lease_expires_at: new Date('2026-12-31T23:59:59Z'),
        summary: { stale: true },
      });
      await expect(service.plan(input)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
  });

  it('does not complete after a journal failure', async () => {
    tx.ecclesiastical_cycle_events.createMany.mockRejectedValueOnce(
      new Error('journal failure'),
    );
    await expect(service.plan(input)).rejects.toThrow('journal failure');
    expect(tx.ecclesiastical_cycle_runs.update).not.toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });
});
