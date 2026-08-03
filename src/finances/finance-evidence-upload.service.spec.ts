import { FinanceEvidenceUploadService } from './finance-evidence-upload.service';

const actor = '00000000-0000-4000-8000-000000000001';
const key = '00000000-0000-4000-8000-000000000002';
const handle = '00000000-0000-4000-8000-000000000003';
const future = new Date('2030-01-01T00:05:00.000Z');
const base = {
  clubId: 1,
  clubSectionId: 7,
  mimeType: 'image/png' as const,
  fileSize: 10,
};
const row = (overrides = {}) => ({
  finance_ledger_evidence_upload_intent_id: handle,
  actor_user_id: actor,
  club_id: 1,
  club_section_id: 7,
  request_hash: '',
  status: 'issued',
  expires_at: future,
  ...overrides,
});

describe('FinanceEvidenceUploadService', () => {
  let tx: any;
  let prisma: any;
  let authorization: any;
  let storage: any;
  let service: FinanceEvidenceUploadService;

  beforeEach(() => {
    tx = {
      system_config: {
        findUnique: jest.fn().mockResolvedValue({ config_value: 'true' }),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      finance_ledger_evidence_upload_intents: {
        create: jest.fn().mockResolvedValue(row()),
      },
      audit_logs: { create: jest.fn() },
    };
    prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    authorization = {
      assertCanRegister: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      issueCreateOnlyPut: jest.fn().mockResolvedValue({
        uploadUrl: 'https://signed.example',
        expiresInSeconds: 300,
        requiredHeaders: { 'Content-Type': 'image/png' },
      }),
    };
    service = new FinanceEvidenceUploadService(prisma, authorization, storage);
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  // prettier-ignore
  it('rejects invalid and caller-controlled storage input before dependencies', async () => { await expect(service.issueUpload({ ...base, storageKey: 'x' } as any, actor, key)).rejects.toMatchObject({ code: 'FINANCE_LEDGER_INPUT_INVALID', status: 400 }); expect(prisma.$transaction).not.toHaveBeenCalled(); expect(storage.issueCreateOnlyPut).not.toHaveBeenCalled(); });

  // prettier-ignore
  it('blocks issue when writes are disabled', async () => { tx.system_config.findUnique.mockResolvedValue({ config_value: 'false' }); await expect(service.issueUpload(base, actor, key)).rejects.toMatchObject({ code: 'FINANCE_LEDGER_DISABLED', status: 403 }); expect(tx.finance_ledger_evidence_upload_intents.create).not.toHaveBeenCalled(); });

  // prettier-ignore
  it('authorizes before lookup, atomically persists an issued intent, then signs it', async () => { const result = await service.issueUpload(base, actor, key); expect(result).toEqual({ uploadHandle: handle, uploadUrl: 'https://signed.example', expiresAt: future.toISOString(), requiredHeaders: { 'Content-Type': 'image/png' } }); expect(authorization.assertCanRegister.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]); expect(tx.finance_ledger_evidence_upload_intents.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actor_user_id: actor, club_id: 1, club_section_id: 7, idempotency_key: key, expected_mime_type: 'image/png', expected_file_size: 10, expires_at: future }) })); expect(JSON.stringify(tx.audit_logs.create.mock.calls[0])).not.toContain(handle); });

  // prettier-ignore
  it('replays matching payload with remaining TTL but fails reuse or revoked authorization safely', async () => { tx.$queryRaw.mockResolvedValue([row({ request_hash: (service as any).requestHash(base) })]); jest.setSystemTime(new Date('2030-01-01T00:04:00.000Z')); await service.issueUpload(base, actor, key); expect(storage.issueCreateOnlyPut).toHaveBeenCalledWith(expect.objectContaining({ uploadId: handle, expiresInSeconds: 60 })); expect(tx.finance_ledger_evidence_upload_intents.create).not.toHaveBeenCalled(); tx.$queryRaw.mockResolvedValue([row({ request_hash: 'different' })]); await expect(service.issueUpload(base, actor, key)).rejects.toMatchObject({ code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED', status: 409 }); authorization.assertCanRegister.mockRejectedValueOnce({ status: 403 }); await expect(service.issueUpload(base, actor, key)).rejects.toMatchObject({ status: 403 }); });

  // prettier-ignore
  it.each(['issued', 'verifying'])('revokes %s under a row lock, clears leases and leaves revoked_at server-owned', async (status) => { tx.$queryRaw.mockResolvedValue([row({ status })]); await service.revokeUpload({ clubId: 1, clubSectionId: 7, uploadHandle: handle }, actor); expect(tx.$queryRaw.mock.calls[0][0].strings.join('')).toContain('FOR UPDATE'); const update = tx.$queryRaw.mock.calls[1][0].strings.join(''); expect(update).toContain('"status" = \'revoked\''); expect(update).not.toContain('revoked_at'); expect(JSON.stringify(tx.audit_logs.create.mock.calls[0])).not.toContain(handle); });

  // prettier-ignore
  it('makes revoked replay silent and converges unavailable state', async () => { tx.$queryRaw.mockResolvedValue([row({ status: 'revoked' })]); await expect(service.revokeUpload({ clubId: 1, clubSectionId: 7, uploadHandle: handle }, actor)).resolves.toBeUndefined(); expect(tx.audit_logs.create).not.toHaveBeenCalled(); tx.$queryRaw.mockResolvedValue([row({ status: 'completed' })]); await expect(service.revokeUpload({ clubId: 1, clubSectionId: 7, uploadHandle: handle }, actor)).rejects.toMatchObject({ code: 'FINANCE_LEDGER_STATUS_INVALID', status: 409 }); });
});
