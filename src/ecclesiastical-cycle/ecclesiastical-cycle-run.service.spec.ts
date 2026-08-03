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
    preflight.execute.mockReset().mockResolvedValue(plan());
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue(null);
    tx.ecclesiastical_cycle_runs.create.mockResolvedValue({ run_id: runId });
    tx.ecclesiastical_cycle_runs.update.mockResolvedValue({ run_id: runId });
    tx.ecclesiastical_cycle_decisions.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(records());
    tx.ecclesiastical_cycle_events.findMany.mockResolvedValue([]);
  });

  // prettier-ignore
  it('locks before exact preflight, batches deterministic decisions, and journals completion', async () => {
    await expect(service.plan(input)).resolves.toEqual({ disposition: 'planned', runId, decisions: 2, skipped: 0 });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 20_000 });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(preflight.execute.mock.invocationCallOrder[0]);
    expect(tx.ecclesiastical_cycle_decisions.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: records().map(({ decision_id: _id, ...decision }) => decision) }));
    expect(tx.ecclesiastical_cycle_events.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ event_type: 'RUN_STARTED' }), expect.objectContaining({ event_type: 'DECISION_PLANNED', payload: { hash: expect.any(String) } }), expect.objectContaining({ event_type: 'RUN_COMPLETED' })]) }));
    expect(tx.ecclesiastical_cycle_runs.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed', lease_token: null }) }));
  });

  // prettier-ignore
  it('replays only the matching durable snapshot, decisions, and journal', async () => {
    const replay = { ...plan(), summary: { total: 0, ready: 0, pendingChoice: 0, blocked: 0 }, cases: [] }, state = { request: input, preflight: replay };
    preflight.execute.mockResolvedValue(replay);
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'completed', summary: state });
    tx.ecclesiastical_cycle_decisions.findMany.mockReset().mockResolvedValue([]);
    tx.ecclesiastical_cycle_events.findMany.mockResolvedValue([{ run_id: runId, decision_id: null, event_key: `run.${runId}.blocked.old`, event_type: 'RUN_BLOCKED' }, { run_id: runId, decision_id: null, event_key: `run.${runId}.started`, event_type: 'RUN_STARTED', actor_user_id: 'actor', payload: { snapshot: state } }, { run_id: runId, decision_id: null, event_key: `run.${runId}.completed`, event_type: 'RUN_COMPLETED', actor_user_id: 'actor', payload: { snapshot: state } }]);
    await expect(service.plan(input)).resolves.toEqual({ disposition: 'replayed', runId });
    expect(tx.ecclesiastical_cycle_decisions.createMany).not.toHaveBeenCalled();
    expect(tx.ecclesiastical_cycle_events.createMany).not.toHaveBeenCalled();
    expect(tx.ecclesiastical_cycle_events.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { run_id: runId } }));
  });

  // prettier-ignore
  it('persists a retryable global preflight block and never completes it', async () => {
    preflight.execute.mockResolvedValue({ ...plan(), reasons: ['TIMEZONE_MISSING'], summary: { total: 0, ready: 0, pendingChoice: 0, blocked: 0 }, cases: [] });
    await expect(service.plan(input)).resolves.toMatchObject({ disposition: 'blocked', runId, retryable: true });
    expect(tx.ecclesiastical_cycle_events.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ event_type: 'RUN_BLOCKED' })] }));
    expect(tx.ecclesiastical_cycle_runs.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'blocked', lease_token: null }) }));
  });

  // prettier-ignore
  it('replans the same blocked run after preflight is corrected', async () => {
    const blocked = plan({ reasons: ['TIMEZONE_MISSING'], cases: [] });
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'blocked', summary: { request: input, preflight: blocked } });
    await expect(service.plan(input)).resolves.toMatchObject({ disposition: 'planned', runId });
  });

  // prettier-ignore
  it('fails closed instead of recreating completed decisions or journal', async () => {
    const replay = plan();
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'completed', summary: { request: input, preflight: replay } });
    preflight.execute.mockResolvedValue(replay);
    tx.ecclesiastical_cycle_decisions.findMany.mockReset().mockResolvedValue([]);
    await expect(service.plan(input)).rejects.toMatchObject({ code: 'ECCLESIASTICAL_CYCLE_RUN_INTEGRITY' });
    expect(tx.ecclesiastical_cycle_decisions.createMany).not.toHaveBeenCalled();
    const empty = plan({ cases: [] });
    preflight.execute.mockResolvedValue(empty);
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'completed', summary: { request: input, preflight: empty } });
    await expect(service.plan(input)).rejects.toMatchObject({ code: 'ECCLESIASTICAL_CYCLE_RUN_INTEGRITY' });
    expect(tx.ecclesiastical_cycle_events.createMany).not.toHaveBeenCalled();
  });

  // prettier-ignore
  it('recovers an expired matching lease and completes its plan', async () => {
    tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValue({ run_id: runId, status: 'running', lease_expires_at: new Date('2026-12-31T23:59:59Z'), summary: { request: input, preflight: plan() } });
    await expect(service.plan(input)).resolves.toMatchObject({ disposition: 'planned', runId });
    expect(tx.ecclesiastical_cycle_runs.update.mock.calls[0][0].data).toMatchObject({ status: 'running', lease_token: expect.any(String) });
  });

  // This mutex models the advisory-lock contract; PostgreSQL behavior belongs to C03b.
  // prettier-ignore
  it('serializes a deterministic interleaving into one plan and one replay', async () => {
    let releasePreflight: (value: any) => void = () => undefined;
    const held = new Promise((resolve) => (releasePreflight = resolve));
    preflight.execute.mockReset().mockReturnValueOnce(held).mockResolvedValue(plan());
    const state = { request: input, preflight: plan() };
    tx.ecclesiastical_cycle_runs.findUnique.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({ run_id: runId, status: 'completed', summary: state });
    let savedDecisions: any[] = [], savedEvents: any[] = [];
    tx.ecclesiastical_cycle_decisions.findMany.mockReset().mockImplementation(() => savedDecisions);
    tx.ecclesiastical_cycle_decisions.createMany.mockImplementation(({ data }) => { savedDecisions = data.map((row: any, index: number) => ({ decision_id: `decision-${index + 1}`, ...row })); });
    tx.ecclesiastical_cycle_events.findMany.mockReset().mockImplementation(() => savedEvents);
    tx.ecclesiastical_cycle_events.createMany.mockImplementation(({ data }) => { savedEvents = data; });
    let tail = Promise.resolve();
    const racePrisma = { $transaction: jest.fn(async (callback) => { const acquired = tail; let release = () => undefined; tail = new Promise<void>((resolve) => (release = resolve)); const raceTx = { ...tx, $executeRaw: jest.fn(() => acquired) }; try { return await callback(raceTx); } finally { release(); } }) };
    const raceService = new EcclesiasticalCycleRunService(racePrisma as never, preflight as never);
    const first = raceService.plan(input), second = raceService.plan(input);
    await new Promise((resolve) => setImmediate(resolve));
    expect(tx.ecclesiastical_cycle_runs.findUnique).toHaveBeenCalledTimes(1);
    releasePreflight(plan());
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ disposition: 'planned' }), expect.objectContaining({ disposition: 'replayed' })]);
    expect(tx.ecclesiastical_cycle_runs.create).toHaveBeenCalledTimes(1);
  });

  // prettier-ignore
  it('rejects mismatched completed or expired durable state before writes', async () => {
    for (const status of ['completed', 'running'] as const) {
      tx.ecclesiastical_cycle_runs.findUnique.mockResolvedValueOnce({ run_id: runId, status, lease_expires_at: new Date('2026-12-31T23:59:59Z'), summary: { stale: true } });
      await expect(service.plan(input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    }
  });

  // prettier-ignore
  it('does not complete after a journal failure', async () => {
    tx.ecclesiastical_cycle_events.createMany.mockRejectedValueOnce(new Error('journal failure'));
    await expect(service.plan(input)).rejects.toThrow('journal failure');
    expect(tx.ecclesiastical_cycle_runs.update).not.toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
  });
});
