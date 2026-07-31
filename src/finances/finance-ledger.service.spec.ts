import { ErrorCode } from '../common/errors/error-codes';
import { AppForbiddenException } from '../common/errors/app.exception';
import { FinanceLedgerService } from './finance-ledger.service';

const actor = '00000000-0000-0000-0000-000000000001';
const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entryId = '10000000-0000-0000-0000-000000000001';
const input = {
  clubId: 1,
  clubSectionId: 7,
  financeCategoryId: 11,
  kind: 'payable' as const,
  amountCentavos: 125050,
  currency: 'MXN',
  financeDate: new Date('2026-07-30T00:00:00.000Z'),
};
const forbidden = () =>
  new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
const ledgerEntry = (overrides: Record<string, any> = {}) => ({
  finance_ledger_entry_id: entryId,
  club_section_id: 7,
  finance_category_id: 11,
  status: 'pending_approval',
  kind: 'payable',
  amount_centavos: 125050,
  currency: 'MXN',
  finance_date: new Date('2026-07-30T00:00:00.000Z'),
  registered_by_id: actor,
  decided_by_id: null,
  decided_at: null,
  rejection_reason: null,
  ...overrides,
});

describe('FinanceLedgerService', () => {
  const tx: any = {
    $executeRaw: jest.fn(),
    system_config: { findUnique: jest.fn() },
    finance_idempotency_receipts: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    finances_categories: { findUnique: jest.fn() },
    finance_currencies: { findUnique: jest.fn() },
    finance_ledger_entries: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    finance_ledger_events: { create: jest.fn() },
    audit_logs: { create: jest.fn() },
  };
  const prisma: any = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const authorization = { assertCanRegister: jest.fn() };
  const decisionAuthorization = { assertCanDecide: jest.fn() };
  let service: FinanceLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceLedgerService(
      prisma,
      authorization,
      decisionAuthorization,
    );
    authorization.assertCanRegister.mockResolvedValue(undefined);
    decisionAuthorization.assertCanDecide.mockResolvedValue(undefined);
    tx.system_config.findUnique.mockResolvedValue({ config_value: 'true' });
    tx.finance_idempotency_receipts.findUnique.mockResolvedValue(null);
    tx.finances_categories.findUnique.mockResolvedValue({
      active: true,
      type: 1,
    });
    tx.finance_currencies.findUnique.mockResolvedValue({ active: true });
    tx.finance_ledger_entries.create.mockResolvedValue(ledgerEntry());
    tx.finance_ledger_entries.findUnique.mockResolvedValue({
      ...ledgerEntry(),
      club_section: { main_club_id: 1 },
    });
    tx.finance_ledger_entries.update.mockResolvedValue(
      ledgerEntry({
        status: 'approved',
        decided_by_id: actor,
        decided_at: new Date('2026-07-31T00:00:00.000Z'),
      }),
    );
  });

  it('registers a pending payable once and replays the durable receipt', async () => {
    let receipt: any;
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique
      .mockResolvedValueOnce(null)
      .mockImplementation(() => receipt);
    const first = await service.registerEntry(input, actor, key);
    const replay = await service.registerEntry(input, actor, key);

    expect(replay).toEqual(first);
    expect(tx.finance_ledger_entries.create).toHaveBeenCalledTimes(1);
    expect(authorization.assertCanRegister).toHaveBeenNthCalledWith(1, {
      transaction: tx,
      actorUserId: actor,
      clubId: 1,
      clubSectionId: 7,
    });
    expect(authorization.assertCanRegister).toHaveBeenCalledTimes(2);
    const event = tx.finance_ledger_events.create.mock.calls[0][0].data;
    const audit = tx.audit_logs.create.mock.calls[0][0].data;
    expect(event.event_type).toBe('CREATED');
    expect(event.actor_user_id).toBe(actor);
    expect(audit.action).toBe('FINANCE_LEDGER_ENTRY_REGISTERED');
    expect(audit.actor_user_id).toBe(actor);
    expect(event.payload).toEqual({
      club_id: 1,
      club_section_id: 7,
      finance_category_id: 11,
      kind: 'payable',
      amount_centavos: 125050,
      currency: 'MXN',
      finance_date: '2026-07-30',
      status: 'pending_approval',
      registered_by_id: actor,
      decided_by_id: null,
      decided_at: null,
      rejection_reason: null,
    });
    expect(audit.changes).toStrictEqual(event.payload);
    const lockOrder = tx.$executeRaw.mock.invocationCallOrder;
    const authOrder = authorization.assertCanRegister.mock.invocationCallOrder;
    expect(lockOrder[0]).toBeLessThan(authOrder[0]);
    expect(authOrder[0]).toBeLessThan(lockOrder[1]);
  });

  it('fails closed while the rollout flag is not exactly true', async () => {
    tx.system_config.findUnique.mockResolvedValue({ config_value: 'false' });

    await expect(
      service.registerEntry(input, actor, key),
    ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_DISABLED' });
  });

  it('rejects an Idempotency-Key reused with another payload', async () => {
    tx.finance_idempotency_receipts.findUnique.mockResolvedValue({
      request_hash: 'different',
      response: {},
    });
    await expect(
      service.registerEntry(input, actor, key),
    ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED' });
  });

  it('reauthorizes a replay and rejects it after role revocation', async () => {
    let receipt: any;
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique.mockImplementation(
      () => receipt,
    );
    await service.registerEntry(input, actor, key);
    authorization.assertCanRegister.mockRejectedValueOnce(forbidden());

    await expect(
      service.registerEntry(input, actor, key),
    ).rejects.toMatchObject({
      code: 'GUARD_PERMISSION_DENIED',
      status: 403,
    });
    expect(tx.finance_idempotency_receipts.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reauthorizes a decision replay before its receipt lookup', async () => {
    tx.finance_idempotency_receipts.findUnique.mockResolvedValueOnce(null);

    await service.decideEntry({ entryId, decision: 'approve' }, actor, key);
    decisionAuthorization.assertCanDecide.mockRejectedValueOnce(forbidden());

    await expect(
      service.decideEntry({ entryId, decision: 'approve' }, actor, key),
    ).rejects.toMatchObject({ code: 'GUARD_PERMISSION_DENIED', status: 403 });
    expect(tx.finance_ledger_entries.update).toHaveBeenCalledTimes(1);
    const event = tx.finance_ledger_events.create.mock.calls[0][0].data;
    const audit = tx.audit_logs.create.mock.calls[0][0].data;
    expect(event.payload).toStrictEqual({
      club_id: 1,
      club_section_id: 7,
      decision: 'approve',
      before: {
        club_id: 1,
        club_section_id: 7,
        finance_category_id: 11,
        kind: 'payable',
        amount_centavos: 125050,
        currency: 'MXN',
        finance_date: '2026-07-30',
        status: 'pending_approval',
        registered_by_id: actor,
        decided_by_id: null,
        decided_at: null,
        rejection_reason: null,
      },
      after: {
        club_id: 1,
        club_section_id: 7,
        finance_category_id: 11,
        kind: 'payable',
        amount_centavos: 125050,
        currency: 'MXN',
        finance_date: '2026-07-30',
        status: 'approved',
        registered_by_id: actor,
        decided_by_id: actor,
        decided_at: '2026-07-31T00:00:00.000Z',
        rejection_reason: null,
      },
    });
    expect(audit.changes).toStrictEqual(event.payload);
    expect(tx.finance_idempotency_receipts.findUnique).toHaveBeenCalledTimes(1);
    const [actorKeyLock, entryLock, entry, authorizationCall, receipt] = [
      tx.$executeRaw.mock.invocationCallOrder[0],
      tx.$executeRaw.mock.invocationCallOrder[1],
      tx.finance_ledger_entries.findUnique.mock.invocationCallOrder[0],
      decisionAuthorization.assertCanDecide.mock.invocationCallOrder[0],
      tx.finance_idempotency_receipts.findUnique.mock.invocationCallOrder[0],
    ];
    expect(actorKeyLock).toBeLessThan(entryLock);
    expect(entryLock).toBeLessThan(entry);
    expect(entry).toBeLessThan(authorizationCall);
    expect(authorizationCall).toBeLessThan(receipt);
    expect([
      ...new Set(tx.$executeRaw.mock.calls.map(([sql]) => sql.values[0])),
    ]).toStrictEqual([
      `finance-ledger-idempotency:${actor}:${key}`,
      `finance-ledger-entry:${entryId}`,
    ]);
  });

  it('rejects a key reused from approve to reject before a second mutation', async () => {
    let receipt: any;
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique
      .mockResolvedValueOnce(null)
      .mockImplementation(() => receipt);
    await service.decideEntry({ entryId, decision: 'approve' }, actor, key);

    await expect(
      service.decideEntry(
        { entryId, decision: 'reject', reason: 'Changed payload' },
        actor,
        key,
      ),
    ).rejects.toMatchObject({
      code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED',
      status: 409,
    });
  });

  it('authorizes only the scope read after the entry lock', async () => {
    tx.finance_ledger_entries.findUnique.mockResolvedValueOnce({
      ...ledgerEntry({ club_section_id: 8 }),
      club_section: { main_club_id: 2 },
    });
    await service.decideEntry({ entryId, decision: 'approve' }, actor, key);
    expect(
      decisionAuthorization.assertCanDecide.mock.calls[0][0],
    ).toMatchObject({
      clubId: 2,
      clubSectionId: 8,
    });
  });

  it('records a rejection reason and denies terminal entries', async () => {
    tx.finance_ledger_entries.update.mockResolvedValueOnce(
      ledgerEntry({
        status: 'rejected',
        decided_by_id: actor,
        decided_at: new Date('2026-07-31T00:00:00.000Z'),
        rejection_reason: 'Missing receipt',
      }),
    );
    await service.decideEntry(
      { entryId, decision: 'reject', reason: 'Missing receipt' },
      actor,
      key,
    );
    expect(
      tx.finance_ledger_events.create.mock.calls[0][0].data.payload.after
        .rejection_reason,
    ).toBe('Missing receipt');
    for (const status of ['approved', 'rejected']) {
      tx.finance_ledger_entries.findUnique.mockResolvedValueOnce({
        ...ledgerEntry({ status }),
        club_section: { main_club_id: 1 },
      });
      await expect(
        service.decideEntry(
          { entryId, decision: 'reject', reason: 'terminal' },
          actor,
          key.replace(/^a/, 'b'),
        ),
      ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_STATUS_INVALID' });
    }
  });
});
