import { BadRequestException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { MfaService } from './mfa.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('MfaService', () => {
  let service: MfaService;

  const mockSetSession = jest.fn();
  const mockEnroll = jest.fn();
  const mockChallenge = jest.fn();
  const mockVerify = jest.fn();
  const mockListFactors = jest.fn();
  const mockUnenroll = jest.fn();
  const mockGetAal = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    (createClient as jest.Mock).mockReturnValue({
      auth: {
        setSession: mockSetSession,
        mfa: {
          enroll: mockEnroll,
          challenge: mockChallenge,
          verify: mockVerify,
          listFactors: mockListFactors,
          unenroll: mockUnenroll,
          getAuthenticatorAssuranceLevel: mockGetAal,
        },
      },
    });

    service = new MfaService();
  });

  it('should bind session using optional refresh token when provided', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockEnroll.mockResolvedValue({
      data: { id: 'factor-1', totp: { qr_code: 'qr', secret: 'sec', uri: 'u' } },
      error: null,
    });

    await service.enrollMfa('access-token', 'refresh-token');

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('should throw MFA_SESSION_BIND_FAILED when refresh token is required but missing', async () => {
    mockSetSession.mockResolvedValue({
      error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
    });

    await expect(service.enrollMfa('access-token')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'MFA_SESSION_BIND_FAILED',
        use: 'x-refresh-token',
      }),
    });
  });

  it('should keep compatibility path when setSession works without refresh token', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockListFactors.mockResolvedValue({
      data: { totp: [] },
      error: null,
    });

    const result = await service.listFactors('access-token');

    expect(result).toEqual([]);
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: '',
    });
  });

  it('should return fallback AAL values on unexpected errors', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetAal.mockRejectedValue(new Error('network'));

    const result = await service.getAuthenticatorAssuranceLevel('access-token');

    expect(result).toEqual({ currentLevel: 'aal1', nextLevel: null });
  });

  it('should throw when access token is missing', async () => {
    await expect(service.enrollMfa('')).rejects.toThrow(BadRequestException);
  });
});
