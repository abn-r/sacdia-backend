import {
  CamporeeOrderProofService,
  PROOF_SIGNED_URL_TTL_SECONDS,
} from './proof.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ProofFileValidationPipe } from './proof-file-validation.pipe';
import { StorageBucketAlias } from '../common/services/file-storage.service';

function pdfFile(overrides: Partial<Express.Multer.File> = {}) {
  return {
    originalname: 'comprobante.pdf',
    mimetype: 'application/pdf',
    size: 1234,
    buffer: Buffer.from('%PDF-1.7 test'),
    ...overrides,
  } as Express.Multer.File;
}

describe('CamporeeOrderProofService', () => {
  const tx = {
    camporee_order_proofs: { create: jest.fn() },
    camporee_orders: { update: jest.fn() },
  };
  const prisma = {
    camporee_order_proofs: {
      create: tx.camporee_order_proofs.create,
      findFirst: jest.fn(),
    },
    camporee_orders: tx.camporee_orders,
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const fileStorage = {
    upload: jest.fn().mockResolvedValue({ key: 'stored-key' }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example'),
  };
  const service = new CamporeeOrderProofService(
    prisma as any,
    fileStorage as any,
  );

  const baseOrder = {
    camporee_order_id: 'order-1',
    local_field_id: 7,
    status: 'ISSUED' as const,
    authorized_without_proof: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fileStorage.upload.mockResolvedValue({ key: 'stored-key' });
    tx.camporee_order_proofs.create.mockResolvedValue({ id: 'proof-1' });
    tx.camporee_orders.update.mockResolvedValue({
      camporee_order_id: 'order-1',
      status: 'PROOF_SUBMITTED',
    });
  });

  it('uploads proof from ISSUED and moves order to PROOF_SUBMITTED', async () => {
    await service.upload(baseOrder, pdfFile(), { userId: 'user-1' });

    expect(fileStorage.upload).toHaveBeenCalledWith(
      StorageBucketAlias.EVIDENCE_FILES,
      expect.stringMatching(/^camporee-orders\/lf-7\/order-order-1\//),
      expect.any(Buffer),
      { contentType: 'application/pdf', overwrite: false },
    );
    expect(tx.camporee_order_proofs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 'order-1',
        r2_key: 'stored-key',
        status: 'SUBMITTED',
        uploaded_by_id: 'user-1',
      }),
    });
    expect(tx.camporee_orders.update).toHaveBeenCalledWith({
      where: { camporee_order_id: 'order-1' },
      data: { status: 'PROOF_SUBMITTED' },
    });
  });

  it('allows re-upload after rejection (same folio)', async () => {
    await service.upload(
      { ...baseOrder, status: 'PROOF_REJECTED' },
      pdfFile(),
      { userId: 'user-1' },
    );
    expect(tx.camporee_orders.update).toHaveBeenCalled();
  });

  it('stores a later documentary proof on PAID without changing status', async () => {
    const result = await service.upload(
      {
        ...baseOrder,
        status: 'PAID',
        authorized_without_proof: true,
      },
      pdfFile(),
      { userId: 'user-1' },
    );

    expect(fileStorage.upload).toHaveBeenCalled();
    expect(tx.camporee_order_proofs.create).toHaveBeenCalled();
    expect(tx.camporee_orders.update).not.toHaveBeenCalled();
    expect(result.documentary).toBe(true);
    expect(result.order.status).toBe('PAID');
  });

  it('stores a later documentary proof on DELIVERED without changing status', async () => {
    await service.upload(
      {
        ...baseOrder,
        status: 'DELIVERED',
        authorized_without_proof: true,
      },
      pdfFile(),
      { userId: 'user-1' },
    );
    expect(tx.camporee_orders.update).not.toHaveBeenCalled();
  });

  it('rejects upload on PAID without authorized_without_proof and skips storage', async () => {
    await expect(
      service.upload({ ...baseOrder, status: 'PAID' }, pdfFile(), {
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_INVALID_TRANSITION,
    });
    expect(fileStorage.upload).not.toHaveBeenCalled();
  });

  it('rejects upload on CANCELLED without touching storage', async () => {
    await expect(
      service.upload({ ...baseOrder, status: 'CANCELLED' }, pdfFile(), {
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_INVALID_TRANSITION,
    });
    expect(fileStorage.upload).not.toHaveBeenCalled();
  });

  it('returns a signed URL with 15 min TTL for the latest proof', async () => {
    prisma.camporee_order_proofs.findFirst.mockResolvedValue({
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
      StorageBucketAlias.EVIDENCE_FILES,
      'stored-key',
      { expiresInSeconds: 900 },
    );
  });

  it('throws when no proof exists', async () => {
    prisma.camporee_order_proofs.findFirst.mockResolvedValue(null);
    await expect(service.getSignedDownload('order-1')).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_PROOF_NOT_FOUND,
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
