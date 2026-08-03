import { ErrorCode } from '../common/errors/error-codes';
import { AppForbiddenException } from '../common/errors/app.exception';
import { FinanceLedgerService } from './finance-ledger.service';

const actor = '00000000-0000-0000-0000-000000000001';
const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entryId = '10000000-0000-0000-0000-000000000001';
const evidenceId = '20000000-0000-0000-0000-000000000002';
const voucherId = '30000000-0000-0000-0000-000000000003';
const input = {
  clubId: 1,
  clubSectionId: 7,
  financeCategoryId: 11,
  kind: 'payable' as const,
  amountCentavos: 125050,
  currency: 'MXN',
  financeDate: new Date('2026-07-30T00:00:00.000Z'),
};
const amendment = (overrides: Record<string, any> = {}) => ({
  entryId,
  clubSectionId: 7,
  financeCategoryId: 11,
  kind: 'expense' as const,
  amountCentavos: 126000,
  currency: 'MXN',
  financeDate: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});
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
    $queryRaw: jest.fn(),
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
    club_sections: { findUnique: jest.fn() },
    finance_vouchers: { create: jest.fn() },
    finance_ledger_events: { create: jest.fn() },
    audit_logs: { create: jest.fn() },
  };
  const prisma: any = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const authorization = { assertCanRegister: jest.fn() };
  const decisionAuthorization = { assertCanDecide: jest.fn() };
  const evidenceOwnership = { resolveOwnedEvidence: jest.fn() };
  let service: FinanceLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceLedgerService(
      prisma,
      authorization,
      decisionAuthorization,
      evidenceOwnership,
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
    tx.club_sections.findUnique.mockResolvedValue({ main_club_id: 1 });
    tx.$queryRaw.mockResolvedValue([{ club_section_id: 7, main_club_id: 1 }]);
    evidenceOwnership.resolveOwnedEvidence.mockResolvedValue({
      financeLedgerEvidenceId: evidenceId,
    });
    tx.finance_vouchers.create.mockResolvedValue({
      finance_voucher_id: voucherId,
      ledger_entry_id: entryId,
      finance_ledger_evidence_id: evidenceId,
      amount_centavos: 125050,
      currency: 'MXN',
    });
  });

  afterEach(() => {
    tx.finance_idempotency_receipts.findUnique.mockReset();
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

  it('uses an explicit UTC date-only value for persisted business dates', async () => {
    await service.registerEntry(input, actor, key);
    await service.amendEntry(amendment(), actor, key.replace(/^a/, 'b'));

    expect(
      tx.finance_ledger_entries.create.mock.calls[0][0].data.finance_date,
    ).toBe('2026-07-30');
    expect(
      tx.finance_ledger_entries.update.mock.calls[0][0].data.finance_date,
    ).toBe('2026-08-01');
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

  it('locks authoritative sections before amendment auth and replays', async () => {
    let receipt: any;
    const amended = ledgerEntry({
      kind: 'expense',
      amount_centavos: 126000,
      finance_date: amendment().financeDate,
    });
    tx.finance_ledger_entries.update.mockResolvedValue(amended);
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique
      .mockResolvedValueOnce(null)
      .mockImplementation(() => receipt);

    const first = await service.amendEntry(amendment(), actor, key);
    tx.finance_ledger_entries.findUnique.mockResolvedValue({
      ...amended,
      club_section: { main_club_id: 1 },
    });
    const replay = await service.amendEntry(amendment(), actor, key);

    expect(replay).toEqual(first);
    expect(tx.finance_ledger_entries.update).toHaveBeenCalledTimes(1);
    const event = tx.finance_ledger_events.create.mock.calls[0][0].data;
    expect(event.payload).toMatchObject({
      before: { kind: 'payable', amount_centavos: 125050 },
      after: { kind: 'expense', amount_centavos: 126000 },
    });
    expect(tx.audit_logs.create.mock.calls[0][0].data.changes).toStrictEqual(
      event.payload,
    );
    const order = [
      tx.$executeRaw.mock.invocationCallOrder[0],
      tx.$executeRaw.mock.invocationCallOrder[1],
      tx.finance_ledger_entries.findUnique.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[0],
      authorization.assertCanRegister.mock.invocationCallOrder[0],
      tx.finance_idempotency_receipts.findUnique.mock.invocationCallOrder[0],
    ];
    expect(order).toStrictEqual([...order].sort((a, b) => a - b));
  });

  it('rejects post-lock membership drift without auth or writes', async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { club_section_id: 7, main_club_id: 1 },
      { club_section_id: 8, main_club_id: 2 },
    ]);
    await expect(
      service.amendEntry(amendment({ clubSectionId: 8 }), actor, key),
    ).rejects.toMatchObject({ code: 'GUARD_PERMISSION_DENIED', status: 403 });
    expect(authorization.assertCanRegister).not.toHaveBeenCalled();
    expect(tx.finance_ledger_entries.update).not.toHaveBeenCalled();
  });

  it('authorizes both locked scopes in deterministic order', async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { club_section_id: 7, main_club_id: 1 },
      { club_section_id: 8, main_club_id: 1 },
    ]);
    authorization.assertCanRegister
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(forbidden());
    await expect(
      service.amendEntry(amendment({ clubSectionId: 8 }), actor, key),
    ).rejects.toMatchObject({ code: 'GUARD_PERMISSION_DENIED', status: 403 });
    expect(tx.$queryRaw.mock.calls[0][0].values).toStrictEqual([7, 8]);
    expect(
      authorization.assertCanRegister.mock.calls.map(
        ([scope]) => scope.clubSectionId,
      ),
    ).toStrictEqual([7, 8]);
  });

  it('rejects a first material no-op without durable side effects', async () => {
    await expect(
      service.amendEntry(amendment(input), actor, key),
    ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_NO_CHANGES', status: 409 });
    for (const mutation of [
      tx.finance_ledger_entries.update,
      tx.finance_ledger_events.create,
      tx.audit_logs.create,
      tx.finance_idempotency_receipts.create,
    ])
      expect(mutation).not.toHaveBeenCalled();
  });

  it.each([
    [
      { registered_by_id: '20000000-0000-0000-0000-000000000002' },
      'GUARD_PERMISSION_DENIED',
    ],
    [{ status: 'approved' }, 'FINANCE_LEDGER_STATUS_INVALID'],
  ])('preserves amendment owner and pending guards', async (override, code) => {
    tx.finance_ledger_entries.findUnique.mockResolvedValueOnce(
      ledgerEntry(override),
    );
    await expect(
      service.amendEntry(amendment(), actor, key),
    ).rejects.toMatchObject({ code });
    expect(tx.finance_ledger_entries.update).not.toHaveBeenCalled();
  });

  it.each([
    { currency: 'mxn' },
    { financeCategoryId: 0 },
    { financeDate: new Date('invalid') },
    { clubSectionId: 0 },
  ])('rejects malformed amendment material', async (material) => {
    await expect(
      service.amendEntry(amendment(material), actor, key),
    ).rejects.toMatchObject({
      code: 'FINANCE_LEDGER_INPUT_INVALID',
      status: 400,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  it('attaches an owned approved voucher without persisting opaque evidence material', async () => {
    let receipt: any;
    tx.finance_ledger_entries.findUnique.mockResolvedValue({
      ...ledgerEntry({ status: 'approved' }),
      club_section: { main_club_id: 1 },
    });
    tx.$queryRaw.mockResolvedValue([
      {
        finance_ledger_evidence_id: evidenceId,
        storage_key: 'finance-ledger/receipt.pdf',
        mime_type: 'application/pdf',
        file_size: 512,
      },
    ]);
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique.mockImplementation(
      () => receipt,
    );

    const first = await service.attachVoucher(
      {
        clubId: 1,
        clubSectionId: 7,
        entryId,
        opaqueEvidenceHandle: 'opaque-a',
      },
      actor,
      key,
    );
    const replay = await service.attachVoucher(
      {
        clubId: 1,
        clubSectionId: 7,
        entryId,
        opaqueEvidenceHandle: 'opaque-a',
      },
      actor,
      key,
    );

    expect(replay).toEqual(first);
    expect(tx.finance_vouchers.create).toHaveBeenCalledTimes(1);
    expect(authorization.assertCanRegister).toHaveBeenCalledTimes(2);
    expect(evidenceOwnership.resolveOwnedEvidence).toHaveBeenCalledTimes(2);
    expect(evidenceOwnership.resolveOwnedEvidence).toHaveBeenCalledWith({
      transaction: tx,
      actorUserId: actor,
      clubId: 1,
      clubSectionId: 7,
      opaqueEvidenceHandle: 'opaque-a',
    });
    expect(tx.finance_vouchers.create.mock.calls[0][0].data).toMatchObject({
      ledger_entry_id: entryId,
      finance_ledger_evidence_id: evidenceId,
      amount_centavos: 125050,
      currency: 'MXN',
      source_uri: 'finance-ledger/receipt.pdf',
      mime_type: 'application/pdf',
      file_size: 512,
      recorded_by_id: actor,
    });
    const event = tx.finance_ledger_events.create.mock.calls[0][0].data;
    const audit = tx.audit_logs.create.mock.calls[0][0].data;
    expect(event).toStrictEqual({
      finance_voucher_id: voucherId,
      event_type: 'VOUCHER_ATTACHED',
      actor_user_id: actor,
      payload: { club_id: 1, club_section_id: 7, entry_id: entryId },
    });
    expect(audit.changes).toStrictEqual(event.payload);
    expect(JSON.stringify(event.payload)).not.toContain('opaque-a');
    expect(JSON.stringify(event.payload)).not.toContain('receipt.pdf');
    const [actorKeyLock, entryLock] = tx.$executeRaw.mock.invocationCallOrder;
    const authorizationCall =
      authorization.assertCanRegister.mock.invocationCallOrder[0];
    const entryLookup =
      tx.finance_ledger_entries.findUnique.mock.invocationCallOrder[0];
    const ownershipLookup =
      evidenceOwnership.resolveOwnedEvidence.mock.invocationCallOrder[0];
    const evidenceLock = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(actorKeyLock).toBeLessThan(authorizationCall);
    expect(authorizationCall).toBeLessThan(entryLock);
    expect(entryLock).toBeLessThan(entryLookup);
    expect(entryLookup).toBeLessThan(ownershipLookup);
    expect(ownershipLookup).toBeLessThan(evidenceLock);
  });

  it.each([undefined, ''])(
    'rejects malformed opaque attachment handles before opening a transaction: %p',
    async (opaqueEvidenceHandle) => {
      await expect(
        service.attachVoucher(
          {
            clubId: 1,
            clubSectionId: 7,
            entryId,
            opaqueEvidenceHandle: opaqueEvidenceHandle as string,
          },
          actor,
          key,
        ),
      ).rejects.toMatchObject({
        code: 'FINANCE_LEDGER_INPUT_INVALID',
        status: 400,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('fails before entry disclosure when the DB-scoped authorization is denied', async () => {
    authorization.assertCanRegister.mockRejectedValueOnce(forbidden());

    await expect(
      service.attachVoucher(
        {
          clubId: 1,
          clubSectionId: 7,
          entryId,
          opaqueEvidenceHandle: 'opaque-a',
        },
        actor,
        key,
      ),
    ).rejects.toMatchObject({ code: 'GUARD_PERMISSION_DENIED', status: 403 });

    expect(tx.finance_ledger_entries.findUnique).not.toHaveBeenCalled();
    expect(evidenceOwnership.resolveOwnedEvidence).not.toHaveBeenCalled();
    expect(tx.finance_vouchers.create).not.toHaveBeenCalled();
  });

  it('rejects changed opaque material under an existing idempotency key without another voucher', async () => {
    tx.finance_ledger_entries.findUnique.mockResolvedValue({
      ...ledgerEntry({ status: 'approved' }),
      club_section: { main_club_id: 1 },
    });
    tx.$queryRaw.mockResolvedValue([
      {
        finance_ledger_evidence_id: evidenceId,
        storage_key: 'finance-ledger/receipt.pdf',
        mime_type: 'application/pdf',
        file_size: 512,
      },
    ]);
    let receipt: any;
    tx.finance_idempotency_receipts.create.mockImplementation(({ data }) => {
      receipt = data;
      return data;
    });
    tx.finance_idempotency_receipts.findUnique.mockImplementation(
      () => receipt,
    );
    await service.attachVoucher(
      {
        clubId: 1,
        clubSectionId: 7,
        entryId,
        opaqueEvidenceHandle: 'opaque-a',
      },
      actor,
      key,
    );

    await expect(
      service.attachVoucher(
        {
          clubId: 1,
          clubSectionId: 7,
          entryId,
          opaqueEvidenceHandle: 'opaque-b',
        },
        actor,
        key,
      ),
    ).rejects.toMatchObject({
      code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED',
      status: 409,
    });
    expect(tx.finance_vouchers.create).toHaveBeenCalledTimes(1);
    expect(evidenceOwnership.resolveOwnedEvidence).toHaveBeenCalledTimes(2);
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
