import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BLACKLIST_BREAKER_COOLDOWN_MS,
  BLACKLIST_OP_TIMEOUT_MS,
  TokenBlacklistService,
} from './token-blacklist.service';

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;

  const mockCache = {
    set: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<TokenBlacklistService>(TokenBlacklistService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockCache.get.mockReset();
    mockCache.set.mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should store global blacklist timestamps in seconds', async () => {
    await service.blacklistAllUserTokens('user-123');

    expect(mockCache.set).toHaveBeenCalledWith(
      'token:blacklist:user:user-123:all',
      expect.stringMatching(/^\d{10}$/),
      86400 * 1000,
    );
  });

  it('keeps tokens issued in the same second valid by default', async () => {
    jest.useFakeTimers({ now: 1_700_000_000_500 });

    await service.blacklistAllUserTokens('user-123');
    mockCache.get.mockResolvedValue(mockCache.set.mock.calls[0][1]);

    await expect(service.checkUserTokens('user-123', 1699999999)).resolves.toBe(
      'revoked',
    );
    await expect(service.checkUserTokens('user-123', 1700000000)).resolves.toBe(
      'ok',
    );
  });

  it('revokes tokens issued in the same second when includeCurrentSecond is set', async () => {
    jest.useFakeTimers({ now: 1_700_000_000_500 });

    await service.blacklistAllUserTokens('user-123', 600, {
      includeCurrentSecond: true,
    });
    mockCache.get.mockResolvedValue(mockCache.set.mock.calls[0][1]);

    expect(mockCache.set).toHaveBeenCalledWith(
      'token:blacklist:user:user-123:all',
      '1700000001',
      600 * 1000,
    );
    await expect(service.checkUserTokens('user-123', 1700000000)).resolves.toBe(
      'revoked',
    );
    await expect(service.checkUserTokens('user-123', 1700000001)).resolves.toBe(
      'ok',
    );
  });

  it('should support legacy millisecond timestamp values', async () => {
    mockCache.get.mockResolvedValue('1700000000000');

    const result = await service.checkUserTokens('user-123', 1699999999);

    expect(result).toBe('revoked');
  });

  it('should return ok when token was issued after global blacklist', async () => {
    mockCache.get.mockResolvedValue('1700000000');

    const result = await service.checkUserTokens('user-123', 1700000001);

    expect(result).toBe('ok');
  });

  it('returns ok when there is no user-wide revocation entry', async () => {
    mockCache.get.mockResolvedValue(undefined);

    await expect(service.checkUserTokens('user-123', 1700000000)).resolves.toBe(
      'ok',
    );
  });

  it('reports revoked / ok for individual tokens', async () => {
    mockCache.get.mockResolvedValueOnce('revoked');
    await expect(service.checkToken('t')).resolves.toBe('revoked');

    mockCache.get.mockResolvedValueOnce(undefined);
    await expect(service.checkToken('t')).resolves.toBe('ok');
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    });

    it('returns unavailable instead of throwing when the cache read fails', async () => {
      mockCache.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.checkToken('t')).resolves.toBe('unavailable');
      await expect(service.checkUserTokens('u', 1)).resolves.toBe(
        'unavailable',
      );
    });

    it('returns unavailable when the cache call hangs past the timeout', async () => {
      mockCache.get.mockReturnValue(new Promise(() => undefined));

      const pending = service.checkToken('t');
      await jest.advanceTimersByTimeAsync(BLACKLIST_OP_TIMEOUT_MS);

      await expect(pending).resolves.toBe('unavailable');
    });

    it('skips the cache during the cooldown and logs the outage once', async () => {
      mockCache.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.checkToken('t');
      jest.advanceTimersByTime(BLACKLIST_BREAKER_COOLDOWN_MS - 1_000);
      await service.checkToken('t');
      await service.checkUserTokens('u', 1);

      expect(mockCache.get).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    });

    it('probes again after the cooldown and logs a single recovery line', async () => {
      mockCache.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await service.checkToken('t');

      jest.advanceTimersByTime(BLACKLIST_BREAKER_COOLDOWN_MS + 1);
      mockCache.get.mockResolvedValue(undefined);

      await expect(service.checkToken('t')).resolves.toBe('ok');
      await expect(service.checkToken('t')).resolves.toBe('ok');
      expect(mockCache.get).toHaveBeenCalledTimes(3);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('recovered'),
      );
      expect(
        (Logger.prototype.log as jest.Mock).mock.calls.filter(([m]) =>
          String(m).includes('recovered'),
        ),
      ).toHaveLength(1);
    });

    it('keeps the breaker open (one new error log at most) when the probe fails', async () => {
      mockCache.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.checkToken('t');

      jest.advanceTimersByTime(BLACKLIST_BREAKER_COOLDOWN_MS + 1);
      await expect(service.checkToken('t')).resolves.toBe('unavailable');
      await expect(service.checkToken('t')).resolves.toBe('unavailable');

      expect(mockCache.get).toHaveBeenCalledTimes(2);
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    });

    it('lets only one probe through at a time once the cooldown elapsed', async () => {
      mockCache.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await service.checkToken('t');
      jest.advanceTimersByTime(BLACKLIST_BREAKER_COOLDOWN_MS + 1);

      let resolveProbe!: (value: undefined) => void;
      mockCache.get.mockReturnValue(
        new Promise<undefined>((resolve) => {
          resolveProbe = resolve;
        }),
      );
      const probe = service.checkToken('t');
      const concurrent = await service.checkToken('t');
      resolveProbe(undefined);

      expect(concurrent).toBe('unavailable');
      await expect(probe).resolves.toBe('ok');
      expect(mockCache.get).toHaveBeenCalledTimes(2);
    });

    it('still attempts writes while the breaker is open and surfaces their errors', async () => {
      mockCache.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.checkToken('t');
      mockCache.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.blacklistAllUserTokens('u')).rejects.toThrow(
        'ECONNREFUSED',
      );
      expect(mockCache.set).toHaveBeenCalledTimes(1);
    });

    it('a failed write opens the breaker and a successful write closes it', async () => {
      mockCache.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.blacklistToken('t', 60)).rejects.toThrow();
      await expect(service.checkToken('t')).resolves.toBe('unavailable');
      expect(mockCache.get).not.toHaveBeenCalled();

      mockCache.set.mockResolvedValueOnce(undefined);
      await service.blacklistToken('t', 60);
      mockCache.get.mockResolvedValue('revoked');

      await expect(service.checkToken('t')).resolves.toBe('revoked');
    });
  });
});
