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
    finance_ledger_entries: { create: jest.fn() },
    finance_ledger_events: { create: jest.fn() },
    audit_logs: { create: jest.fn() },
  };
  const prisma: any = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const authorization = { assertCanRegister: jest.fn() };
  let service: FinanceLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceLedgerService(prisma, authorization);
    authorization.assertCanRegister.mockResolvedValue(undefined);
    tx.system_config.findUnique.mockResolvedValue({ config_value: 'true' });
    tx.finance_idempotency_receipts.findUnique.mockResolvedValue(null);
    tx.finances_categories.findUnique.mockResolvedValue({
      active: true,
      type: 1,
    });
    tx.finance_currencies.findUnique.mockResolvedValue({ active: true });
    tx.finance_ledger_entries.create.mockResolvedValue({
      finance_ledger_entry_id: entryId,
      status: 'pending_approval',
      kind: 'payable',
      amount_centavos: 125050,
      currency: 'MXN',
    });
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
    });
    expect(audit.changes).toEqual(event.payload);
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
});
