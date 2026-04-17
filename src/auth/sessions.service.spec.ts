import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';
const SESSION_A = 'session-uuid-a';
const SESSION_B = 'session-uuid-b';

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1000);

function makeRow(overrides: Partial<{
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: SESSION_A,
    userId: USER_ID,
    token: 'tok',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    ipAddress: '203.0.113.0',
    expiresAt: futureDate,
    createdAt: new Date('2026-04-17T10:00:00Z'),
    updatedAt: new Date('2026-04-17T12:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  session: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // listSessions
  // -------------------------------------------------------------------------

  describe('listSessions', () => {
    it('returns mapped sessions with is_current true for matching sid', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        makeRow({ id: SESSION_A }),
        makeRow({ id: SESSION_B, userAgent: 'Android/Chrome' }),
      ]);

      const result = await service.listSessions(USER_ID, SESSION_A);

      expect(result.current_session_id).toBe(SESSION_A);
      expect(result.sessions).toHaveLength(2);

      const current = result.sessions.find((s) => s.session_id === SESSION_A);
      const other = result.sessions.find((s) => s.session_id === SESSION_B);

      expect(current?.is_current).toBe(true);
      expect(other?.is_current).toBe(false);
    });

    it('returns is_current false for all sessions when sid is null', async () => {
      mockPrisma.session.findMany.mockResolvedValue([makeRow()]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.current_session_id).toBeNull();
      expect(result.sessions[0].is_current).toBe(false);
    });

    it('maps iOS device type and name correctly', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        makeRow({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }),
      ]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.sessions[0].device_type).toBe('ios');
      expect(result.sessions[0].device_name).toBe('iPhone');
    });

    it('maps Android device correctly', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        makeRow({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel)' }),
      ]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.sessions[0].device_type).toBe('android');
      expect(result.sessions[0].device_name).toBe('Android');
    });

    it('maps web browser correctly', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        makeRow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' }),
      ]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.sessions[0].device_type).toBe('web');
      expect(result.sessions[0].device_name).toBe('Chrome');
    });

    it('returns unknown device when userAgent is null', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        makeRow({ userAgent: null }),
      ]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.sessions[0].device_type).toBe('unknown');
      expect(result.sessions[0].device_name).toBeNull();
    });

    it('always returns location as null', async () => {
      mockPrisma.session.findMany.mockResolvedValue([makeRow()]);

      const result = await service.listSessions(USER_ID, null);

      expect(result.sessions[0].location).toBeNull();
    });

    it('returns empty sessions array when no active sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      const result = await service.listSessions(USER_ID, SESSION_A);

      expect(result.sessions).toHaveLength(0);
      expect(result.current_session_id).toBe(SESSION_A);
    });

    it('filters by userId and non-expired sessions via prisma query', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      await service.listSessions(USER_ID, null);

      expect(mockPrisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeSession
  // -------------------------------------------------------------------------

  describe('revokeSession', () => {
    it('throws BadRequestException when sessionId matches currentSid', async () => {
      await expect(
        service.revokeSession(USER_ID, SESSION_A, SESSION_A),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when session does not exist', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeSession(USER_ID, null, SESSION_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when session is already expired', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(
        makeRow({ expiresAt: pastDate }),
      );

      await expect(
        service.revokeSession(USER_ID, null, SESSION_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when session belongs to another user', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(
        makeRow({ userId: OTHER_USER_ID }),
      );

      await expect(
        service.revokeSession(USER_ID, null, SESSION_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deletes the session on success', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(makeRow());
      mockPrisma.session.delete.mockResolvedValue(makeRow());

      await service.revokeSession(USER_ID, SESSION_B, SESSION_A);

      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { id: SESSION_A },
      });
    });

    it('allows revoking when currentSid is null (legacy token)', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(makeRow());
      mockPrisma.session.delete.mockResolvedValue(makeRow());

      // Should NOT throw BadRequestException even though sid is null
      await expect(
        service.revokeSession(USER_ID, null, SESSION_A),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // revokeAllOtherSessions
  // -------------------------------------------------------------------------

  describe('revokeAllOtherSessions', () => {
    it('excludes current session from deletion when sid is present', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.revokeAllOtherSessions(USER_ID, SESSION_A);

      expect(result.revoked_count).toBe(3);
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          id: { not: SESSION_A },
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('deletes all sessions when currentSid is null', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeAllOtherSessions(USER_ID, null);

      expect(result.revoked_count).toBe(2);
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('returns zero when no sessions exist to revoke', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeAllOtherSessions(USER_ID, SESSION_A);

      expect(result.revoked_count).toBe(0);
    });
  });
});
