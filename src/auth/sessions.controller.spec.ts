import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-1';
const SESSION_A = 'session-uuid-a';
const SESSION_B = 'session-uuid-b';

function makeUser(overrides: Record<string, unknown> = {}) {
  return { user_id: USER_ID, sid: SESSION_A, email: 'u@test.com', ...overrides };
}

function makeReq(userOverrides: Record<string, unknown> = {}) {
  return { user: makeUser(userOverrides) } as any;
}

const sessionListResponse = {
  sessions: [
    {
      session_id: SESSION_A,
      device_type: 'ios',
      device_name: 'iPhone',
      ip_address: '1.2.3.4',
      location: null,
      user_agent: 'Mozilla/5.0 (iPhone)',
      created_at: '2026-04-17T10:00:00.000Z',
      last_active_at: '2026-04-17T12:00:00.000Z',
      is_current: true,
      expires_at: '2026-04-24T10:00:00.000Z',
    },
  ],
  current_session_id: SESSION_A,
};

// ---------------------------------------------------------------------------
// Mock SessionsService
// ---------------------------------------------------------------------------

const mockSessionsService = {
  listSessions: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllOtherSessions: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionsController', () => {
  let controller: SessionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: mockSessionsService },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // GET /auth/sessions
  // -------------------------------------------------------------------------

  describe('listSessions', () => {
    it('calls service with user_id and sid from JWT', async () => {
      mockSessionsService.listSessions.mockResolvedValue(sessionListResponse);

      const result = await controller.listSessions(makeReq());

      expect(mockSessionsService.listSessions).toHaveBeenCalledWith(
        USER_ID,
        SESSION_A,
      );
      expect(result).toEqual(sessionListResponse);
    });

    it('passes null sid when JWT has no sid claim (legacy token)', async () => {
      mockSessionsService.listSessions.mockResolvedValue({
        sessions: [],
        current_session_id: null,
      });

      await controller.listSessions(makeReq({ sid: undefined }));

      expect(mockSessionsService.listSessions).toHaveBeenCalledWith(
        USER_ID,
        null,
      );
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions/:sessionId
  // -------------------------------------------------------------------------

  describe('revokeSession', () => {
    it('calls service with user_id, sid, and sessionId', async () => {
      mockSessionsService.revokeSession.mockResolvedValue(undefined);

      await controller.revokeSession(makeReq(), SESSION_B);

      expect(mockSessionsService.revokeSession).toHaveBeenCalledWith(
        USER_ID,
        SESSION_A,
        SESSION_B,
      );
    });

    it('propagates BadRequestException from service (self-revocation)', async () => {
      mockSessionsService.revokeSession.mockRejectedValue(
        new BadRequestException('use logout instead'),
      );

      await expect(
        controller.revokeSession(makeReq(), SESSION_A),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates ForbiddenException from service (wrong user)', async () => {
      mockSessionsService.revokeSession.mockRejectedValue(
        new ForbiddenException('not your session'),
      );

      await expect(
        controller.revokeSession(makeReq(), SESSION_B),
      ).rejects.toThrow(ForbiddenException);
    });

    it('propagates NotFoundException from service', async () => {
      mockSessionsService.revokeSession.mockRejectedValue(
        new NotFoundException('session not found'),
      );

      await expect(
        controller.revokeSession(makeReq(), 'nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns void (204) on success', async () => {
      mockSessionsService.revokeSession.mockResolvedValue(undefined);

      const result = await controller.revokeSession(makeReq(), SESSION_B);

      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions
  // -------------------------------------------------------------------------

  describe('revokeAllSessions', () => {
    it('calls service with user_id and sid', async () => {
      mockSessionsService.revokeAllOtherSessions.mockResolvedValue({
        revoked_count: 4,
      });

      const result = await controller.revokeAllSessions(makeReq());

      expect(mockSessionsService.revokeAllOtherSessions).toHaveBeenCalledWith(
        USER_ID,
        SESSION_A,
      );
      expect(result).toEqual({ revoked_count: 4 });
    });

    it('passes null sid for legacy JWT', async () => {
      mockSessionsService.revokeAllOtherSessions.mockResolvedValue({
        revoked_count: 2,
      });

      await controller.revokeAllSessions(makeReq({ sid: null }));

      expect(mockSessionsService.revokeAllOtherSessions).toHaveBeenCalledWith(
        USER_ID,
        null,
      );
    });

    it('returns zero count when nothing to revoke', async () => {
      mockSessionsService.revokeAllOtherSessions.mockResolvedValue({
        revoked_count: 0,
      });

      const result = await controller.revokeAllSessions(makeReq());

      expect(result.revoked_count).toBe(0);
    });
  });
});
