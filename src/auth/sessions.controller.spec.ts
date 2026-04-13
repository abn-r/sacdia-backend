import { Test, TestingModule } from '@nestjs/testing';
import { SessionsController } from './sessions.controller';
import { SessionManagementService } from '../common/services/session-management.service';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';

describe('SessionsController', () => {
  let controller: SessionsController;

  const mockSessionService = {
    getSessionStats: jest.fn(),
    removeSession: jest.fn(),
    removeAllSessions: jest.fn(),
  };

  const mockTokenBlacklistService = {
    blacklistAllUserTokens: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionManagementService, useValue: mockSessionService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listSessions', () => {
    it('should return user session stats', async () => {
      const req = { user: { user_id: 'user-123' } } as any;
      const expected = {
        activeSessions: 2,
        maxSessions: 5,
        sessions: [
          { sessionId: 's1', deviceInfo: 'Chrome', ipAddress: '127.0.0.1' },
          { sessionId: 's2', deviceInfo: 'Safari', ipAddress: '127.0.0.2' },
        ],
      };
      mockSessionService.getSessionStats.mockResolvedValue(expected);

      const result = await controller.listSessions(req);

      expect(mockSessionService.getSessionStats).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('closeSession', () => {
    it('should close a specific session for current user', async () => {
      const req = { user: { user_id: 'user-123' } } as any;
      mockSessionService.removeSession.mockResolvedValue(undefined);

      const result = await controller.closeSession(req, 'session-abc');

      expect(mockSessionService.removeSession).toHaveBeenCalledWith(
        'user-123',
        'session-abc',
      );
      expect(result).toEqual({
        success: true,
        message: 'Session closed',
      });
    });
  });

  describe('closeAllSessions', () => {
    it('should blacklist and close all sessions for current user', async () => {
      const req = { user: { user_id: 'user-123' } } as any;
      mockTokenBlacklistService.blacklistAllUserTokens.mockResolvedValue(
        undefined,
      );
      mockSessionService.removeAllSessions.mockResolvedValue(3);

      const result = await controller.closeAllSessions(req);

      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).toHaveBeenCalledWith('user-123');
      expect(mockSessionService.removeAllSessions).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toEqual({
        success: true,
        message: '3 sessions closed. Please login again.',
      });
    });
  });
});
