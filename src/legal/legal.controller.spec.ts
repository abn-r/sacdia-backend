import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/guards';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { UserAwareThrottlerGuard } from '../config/user-aware-throttler.guard';
import { LegalAcceptanceController } from './legal-acceptance.controller';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

const mockLegalService = {
  getCurrent: jest.fn(),
  getStatus: jest.fn(),
  accept: jest.fn(),
};

const reflect = (key: string, target: object) =>
  Reflect.getMetadata(key, target) as unknown;

describe('LegalController', () => {
  let controller: LegalController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [LegalController],
      providers: [{ provide: LegalService, useValue: mockLegalService }],
    }).compile();
    controller = module.get(LegalController);
  });

  it('GET /legal/current is @Public and returns the documents envelope', () => {
    expect(reflect(IS_PUBLIC_KEY, LegalController.prototype.getCurrent)).toBe(
      true,
    );
    const documents = [
      { document_type: 'terms', version: '2.0.0-family', url: 'u1' },
    ];
    mockLegalService.getCurrent.mockReturnValue(documents);
    expect(controller.getCurrent()).toEqual({
      status: 'success',
      data: { documents },
    });
  });

  it('skips the permissions guard (fail-closed opt-out)', () => {
    expect(reflect(SKIP_PERMISSIONS_KEY, LegalController)).toBe(true);
  });
});

describe('LegalAcceptanceController', () => {
  let controller: LegalAcceptanceController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [LegalAcceptanceController],
      providers: [{ provide: LegalService, useValue: mockLegalService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserAwareThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(LegalAcceptanceController);
  });

  it('requires JwtAuthGuard, is not @Public and skips permissions', () => {
    expect(reflect(GUARDS_METADATA, LegalAcceptanceController)).toContain(
      JwtAuthGuard,
    );
    expect(reflect(IS_PUBLIC_KEY, LegalAcceptanceController)).toBeUndefined();
    expect(
      reflect(IS_PUBLIC_KEY, LegalAcceptanceController.prototype.accept),
    ).toBeUndefined();
    expect(reflect(SKIP_PERMISSIONS_KEY, LegalAcceptanceController)).toBe(true);
  });

  it('throttles GET and POST (POST stricter than GET)', () => {
    const get = reflect(
      'THROTTLER:LIMITshort',
      LegalAcceptanceController.prototype.getStatus,
    );
    const post = reflect(
      'THROTTLER:LIMITshort',
      LegalAcceptanceController.prototype.accept,
    );
    expect(get).toBe(30);
    expect(post).toBe(10);
  });

  it('GET uses req.user.sub', async () => {
    const status = { requires_acceptance: true, documents: [] };
    mockLegalService.getStatus.mockResolvedValue(status);
    const result = await controller.getStatus({
      user: { sub: 'user-1' },
      headers: {},
    });
    expect(mockLegalService.getStatus).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ status: 'success', data: status });
  });

  it('POST passes req.user.sub, the dto versions and the request context', async () => {
    const status = { requires_acceptance: false, documents: [] };
    mockLegalService.accept.mockResolvedValue(status);
    const req = {
      user: { sub: 'user-1' },
      headers: { 'user-agent': 'SACDIA/1.0' },
      ip: '203.0.113.45',
      socket: { remoteAddress: '127.0.0.1' },
    };
    const result = await controller.accept(req, {
      terms_version: '2.0.0-family',
      privacy_version: '2.0.0-family',
    });
    expect(mockLegalService.accept).toHaveBeenCalledWith(
      'user-1',
      { terms: '2.0.0-family', privacy: '2.0.0-family' },
      expect.objectContaining({ userAgent: 'SACDIA/1.0' }),
      null,
    );
    expect(result).toEqual({ status: 'success', data: status });
  });

  it('POST while acting records the guardian (actor_sub) as the one who accepted', async () => {
    mockLegalService.accept.mockResolvedValue({
      requires_acceptance: false,
      documents: [],
    });
    const req = {
      // Substituted principal: sub is the dependent, actor_sub the guardian.
      user: { sub: 'child-1', actor_sub: 'guardian-1', acting_for: true },
      headers: {},
      ip: '203.0.113.45',
      socket: { remoteAddress: '127.0.0.1' },
    };
    await controller.accept(req, {
      terms_version: '2.0.0-family',
      privacy_version: '2.0.0-family',
    });
    expect(mockLegalService.accept).toHaveBeenCalledWith(
      'child-1',
      { terms: '2.0.0-family', privacy: '2.0.0-family' },
      expect.any(Object),
      'guardian-1',
    );
  });
});
