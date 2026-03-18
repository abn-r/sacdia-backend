import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { TokenBlacklistService } from './token-blacklist.service';

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should store global blacklist timestamps in seconds', async () => {
    await service.blacklistAllUserTokens('user-123');

    expect(mockCache.set).toHaveBeenCalledWith(
      'token:blacklist:user:user-123:all',
      expect.stringMatching(/^\d{10}$/),
      86400 * 1000,
    );
  });

  it('should support legacy millisecond timestamp values', async () => {
    mockCache.get.mockResolvedValue('1700000000000');

    const result = await service.isUserBlacklisted('user-123', 1699999999);

    expect(result).toBe(true);
  });

  it('should return false when token was issued after global blacklist', async () => {
    mockCache.get.mockResolvedValue('1700000000');

    const result = await service.isUserBlacklisted('user-123', 1700000001);

    expect(result).toBe(false);
  });
});
