import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import type { Request, Response } from 'express';

const throttlerLimitMetadata = 'THROTTLER:LIMIT';
const throttlerTtlMetadata = 'THROTTLER:TTL';

describe('QrController', () => {
  let controller: QrController;

  const mockQrService = {
    generateMemberToken: jest.fn(),
    getMyQr: jest.fn(),
    getMyCard: jest.fn(),
    generateMyCardPdf: jest.fn(),
    validateMemberQr: jest.fn(),
    scanMemberToken: jest.fn(),
  };

  beforeEach(() => {
    controller = new QrController(mockQrService as unknown as QrService);
  });

  it('delegates QR metadata to the service', async () => {
    mockQrService.getMyQr.mockResolvedValue({ token: 't' });
    const req = { user: { user_id: 'user-1' } } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.getMe(req, res)).resolves.toEqual({ token: 't' });
    expect(mockQrService.getMyQr).toHaveBeenCalledWith('user-1');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
  });

  it('delegates card payloads to the service', async () => {
    mockQrService.getMyCard.mockResolvedValue({ token: 't' });
    const req = { user: { user_id: 'user-1' } } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.getCard(req, res)).resolves.toEqual({ token: 't' });
    expect(mockQrService.getMyCard).toHaveBeenCalledWith('user-1');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
  });

  it('writes PDF card responses to the HTTP stream', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mocked');
    mockQrService.generateMyCardPdf.mockResolvedValue(pdfBuffer);

    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;

    const result = await controller.getCardPdf(
      { user: { user_id: 'user-1' } } as unknown as Request,
      res,
    );

    expect(result).toBeUndefined();
    expect(mockQrService.generateMyCardPdf).toHaveBeenCalledWith('user-1');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(res.end).toHaveBeenCalledWith(pdfBuffer);
  });

  it('delegates validate and legacy scan routes independently', async () => {
    mockQrService.validateMemberQr.mockResolvedValue({ valid: true });
    mockQrService.scanMemberToken.mockResolvedValue({
      member: { user_id: 'u' },
    });
    const req = { user: { user_id: 'validator-1' } } as unknown as Request;

    await expect(
      controller.validate(req, { token: 'token-1' }),
    ).resolves.toEqual({ valid: true });
    await expect(controller.scan(req, { token: 'token-1' })).resolves.toEqual({
      member: { user_id: 'u' },
    });
  });

  it('applies named throttler overrides to self-service QR reads', () => {
    for (const handlerName of [
      'getMemberToken',
      'getMe',
      'getCard',
      'getCardPdf',
    ] as const) {
      const handler = QrController.prototype[handlerName];

      for (const throttlerName of ['short', 'medium', 'long']) {
        expect(
          Reflect.getMetadata(
            `${throttlerLimitMetadata}${throttlerName}`,
            handler,
          ),
        ).toBe(10);
        expect(
          Reflect.getMetadata(
            `${throttlerTtlMetadata}${throttlerName}`,
            handler,
          ),
        ).toBe(60_000);
      }
    }
  });

  it('applies named throttler overrides to QR scan writes', () => {
    for (const handlerName of ['validate', 'scan'] as const) {
      const handler = QrController.prototype[handlerName];

      for (const throttlerName of ['short', 'medium', 'long']) {
        expect(
          Reflect.getMetadata(
            `${throttlerLimitMetadata}${throttlerName}`,
            handler,
          ),
        ).toBe(60);
        expect(
          Reflect.getMetadata(
            `${throttlerTtlMetadata}${throttlerName}`,
            handler,
          ),
        ).toBe(60_000);
      }
    }
  });
});
