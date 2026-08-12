import {
  FieldPaymentOrderProofService,
  PROOF_SIGNED_URL_TTL_SECONDS,
} from './field-payment-order-proof.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ProofFileValidationPipe } from './proof-file-validation.pipe';

function pdfFile(overrides: Partial<Express.Multer.File> = {}) {
  return {
    originalname: 'comprobante.pdf',
    mimetype: 'application/pdf',
    size: 1234,
    buffer: Buffer.from('%PDF-1.7 test'),
    ...overrides,
  } as Express.Multer.File;
}

describe('FieldPaymentOrderProofService', () => {
  const tx = {
    field_payment_order_proofs: { create: jest.fn() },
    field_payment_orders: { update: jest.fn() },
  };
  const prisma = {
    field_payment_order_proofs: {
      create: tx.field_payment_order_proofs.create,
      findFirst: jest.fn(),
    },
    field_payment_orders: tx.field_payment_orders,
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const fileStorage = {
    upload: jest.fn().mockResolvedValue({ key: 'stored-key' }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example'),
  };
  const service = new FieldPaymentOrderProofService(
    prisma as any,
    fileStorage as any,
  );

  const baseOrder = {
    field_payment_order_id: 'order-1',
    local_field_id: 7,
    status: 'ISSUED' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fileStorage.upload.mockResolvedValue({ key: 'stored-key' });
    tx.field_payment_order_proofs.create.mockResolvedValue({ id: 'proof-1' });
    tx.field_payment_orders.update.mockResolvedValue({
      field_payment_order_id: 'order-1',
      status: 'PROOF_SUBMITTED',
    });
  });

  it('uploads proof from ISSUED and moves order to PROOF_SUBMITTED', async () => {
    await service.upload(baseOrder, pdfFile(), { userId: 'user-1' });

    expect(fileStorage.upload).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^field-payment-orders\/lf-7\/order-order-1\//),
      expect.any(Buffer),
      { contentType: 'application/pdf', overwrite: false },
    );
    expect(tx.field_payment_order_proofs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        field_payment_order_id: 'order-1',
        r2_key: 'stored-key',
        status: 'SUBMITTED',
        uploaded_by_id: 'user-1',
      }),
    });
    expect(tx.field_payment_orders.update).toHaveBeenCalledWith({
      where: { field_payment_order_id: 'order-1' },
      data: { status: 'PROOF_SUBMITTED' },
    });
  });

  it('allows re-upload after rejection (same folio)', async () => {
    await service.upload(
      { ...baseOrder, status: 'PROOF_REJECTED' },
      pdfFile(),
      { userId: 'user-1' },
    );
    expect(tx.field_payment_orders.update).toHaveBeenCalled();
  });

  it('rejects upload on APPROVED order without touching storage', async () => {
    await expect(
      service.upload({ ...baseOrder, status: 'APPROVED' }, pdfFile(), {
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_INVALID_TRANSITION,
    });
    expect(fileStorage.upload).not.toHaveBeenCalled();
  });

  it('returns a signed URL with 15 min TTL for the latest proof', async () => {
    prisma.field_payment_order_proofs.findFirst.mockResolvedValue({
      r2_key: 'stored-key',
      file_name: 'comprobante.pdf',
      mime_type: 'application/pdf',
      status: 'SUBMITTED',
      uploaded_by_id: 'user-1',
      created_at: new Date(),
    });

    const result = await service.getSignedDownload('order-1');
    expect(result.url).toBe('https://signed.example');
    expect(result.expires_in).toBe(PROOF_SIGNED_URL_TTL_SECONDS);
    expect(PROOF_SIGNED_URL_TTL_SECONDS).toBe(900);
    expect(fileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      'stored-key',
      { expiresInSeconds: 900 },
    );
  });

  it('throws when no proof exists', async () => {
    prisma.field_payment_order_proofs.findFirst.mockResolvedValue(null);
    await expect(service.getSignedDownload('order-1')).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_PROOF_NOT_FOUND,
    });
  });
});

describe('ProofFileValidationPipe', () => {
  const pipe = new ProofFileValidationPipe();

  it('accepts a valid PDF', () => {
    expect(() => pipe.transform(pdfFile())).not.toThrow();
  });

  it('rejects missing file', () => {
    expect(() => pipe.transform(undefined)).toThrow(AppException);
  });

  it('rejects oversized file', () => {
    expect(() =>
      pipe.transform(pdfFile({ size: 11 * 1024 * 1024 })),
    ).toThrow(AppException);
  });

  it('rejects unsupported mime', () => {
    expect(() =>
      pipe.transform(pdfFile({ mimetype: 'image/gif' })),
    ).toThrow(AppException);
  });

  it('rejects mime spoofing via magic bytes', () => {
    expect(() =>
      pipe.transform(
        pdfFile({ mimetype: 'image/png', buffer: Buffer.from('%PDF-1.7') }),
      ),
    ).toThrow(AppException);
  });
});
