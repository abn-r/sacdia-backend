import { InsuranceEvidenceService } from './insurance-evidence.service';

describe('InsuranceEvidenceService', () => {
  const storage = {
    upload: jest.fn(),
    deleteMany: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };
  const prisma = {
    insurance_evidence_files: { create: jest.fn(), findFirst: jest.fn() },
    insurance_purchases: { findUnique: jest.fn() },
  };
  const service = new InsuranceEvidenceService(prisma as any, storage as any);

  beforeEach(() => jest.clearAllMocks());

  it('requires purchase_proof and rejects unsupported MIME, oversized, and spoofed files', async () => {
    await expect(
      service.storePurchaseProof(1, undefined, { userId: 'u1' }),
    ).rejects.toMatchObject({ code: 'INSURANCE_EVIDENCE_FILE_REQUIRED' });

    await expect(
      service.assertPurchaseProof({
        size: 10 * 1024 * 1024 + 1,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF'),
      } as Express.Multer.File),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    await expect(
      service.assertPurchaseProof({
        size: 4,
        mimetype: 'image/jpeg',
        buffer: Buffer.from('%PDF'),
      } as Express.Multer.File),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_INVALID' });
  });

  it('persists only the R2 key and metadata, never an upload URL', async () => {
    storage.upload.mockResolvedValue({
      key: 'insurance/lf-3/purchase-1/proof.pdf',
      url: 'https://private.example/upload-url',
    });
    prisma.insurance_evidence_files.create.mockResolvedValue({
      insurance_evidence_file_id: 1,
    });

    await service.storePurchaseProof(
      1,
      {
        originalname: 'proof.pdf',
        size: 4,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF'),
      } as Express.Multer.File,
      { userId: 'u1', localFieldId: 3 },
    );

    expect(prisma.insurance_evidence_files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          file_key: 'insurance/lf-3/purchase-1/proof.pdf',
          file_name: 'proof.pdf',
          mime_type: 'application/pdf',
        }),
      }),
    );
    expect(
      prisma.insurance_evidence_files.create.mock.calls[0][0].data,
    ).not.toHaveProperty('url');
  });

  it('issues a short signed URL only to an actor in the purchase local field', async () => {
    prisma.insurance_evidence_files.findFirst.mockResolvedValue({
      file_key: 'insurance/lf-3/purchase-1/proof.pdf',
      purchase: { cycle_config: { local_field_id: 3 } },
    });
    storage.getSignedDownloadUrl.mockResolvedValue(
      'https://signed.example/proof',
    );

    await expect(
      service.getPurchaseProofUrl(1, { userId: 'u1', localFieldId: 4 }),
    ).rejects.toMatchObject({
      code: 'INSURANCE_EVIDENCE_OUTSIDE_LOCAL_FIELD',
    });
    await expect(
      service.getPurchaseProofUrl(1, { userId: 'u1', localFieldId: 3 }),
    ).resolves.toBe('https://signed.example/proof');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      'INSURANCE_EVIDENCE',
      'insurance/lf-3/purchase-1/proof.pdf',
      { expiresInSeconds: 300 },
    );
  });
});
