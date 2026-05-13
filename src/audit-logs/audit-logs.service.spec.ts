import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  const mockPrisma = {
    audit_logs: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    users: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('recordEvent', () => {
    it('persists the event to audit_logs', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 1n });

      await service.recordEvent({
        entity_type: 'club',
        entity_id: '42',
        action: 'CREATED',
        club_id: 42,
        actor_user_id: 'user-uuid',
        summary: 'Club creado: Test',
      });

      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entity_type: 'club',
            entity_id: '42',
            action: 'CREATED',
            club_id: 42,
          }),
        }),
      );
    });

    it('swallows errors without rethrowing', async () => {
      mockPrisma.audit_logs.create.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Should NOT throw
      await expect(
        service.recordEvent({
          entity_type: 'club',
          entity_id: '1',
          action: 'DELETED',
        }),
      ).resolves.toBeUndefined();
    });

    it('maps undefined optional fields to null', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 2n });

      await service.recordEvent({
        entity_type: 'club_section',
        entity_id: '5',
        action: 'UPDATED',
      });

      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            club_id: null,
            actor_user_id: null,
            summary: null,
          }),
        }),
      );
    });
  });

  describe('listByClub', () => {
    const makeRow = (id: bigint, actorId: string | null = null) => ({
      audit_log_id: id,
      entity_type: 'club',
      entity_id: '42',
      action: 'CREATED',
      summary: 'Club creado',
      actor_user_id: actorId,
      created_at: new Date('2026-05-13T10:00:00Z'),
    });

    it('returns items with serialized audit_log_id as string', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([makeRow(1n)]);
      mockPrisma.users.findMany.mockResolvedValue([]);

      const result = await service.listByClub(42, {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].audit_log_id).toBe('1');
      expect(result.next_cursor).toBeNull();
    });

    it('sets next_cursor when more rows exist', async () => {
      // Request 2, return 3 (limit+1) → indicates there is a next page
      const rows = [makeRow(3n), makeRow(2n), makeRow(1n)];
      mockPrisma.audit_logs.findMany.mockResolvedValue(rows);
      mockPrisma.users.findMany.mockResolvedValue([]);

      const result = await service.listByClub(42, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.next_cursor).toBe('2');
    });

    it('hydrates actor from users table', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([
        makeRow(1n, 'actor-uuid'),
      ]);
      mockPrisma.users.findMany.mockResolvedValue([
        {
          user_id: 'actor-uuid',
          name: 'Juan',
          paternal_last_name: 'Pérez',
        },
      ]);

      const result = await service.listByClub(42, {});

      expect(result.items[0].actor).toEqual({
        user_id: 'actor-uuid',
        name: 'Juan',
        paternal_last_name: 'Pérez',
      });
    });

    it('returns actor null when user no longer exists', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([
        makeRow(1n, 'deleted-user-uuid'),
      ]);
      mockPrisma.users.findMany.mockResolvedValue([]); // user not found

      const result = await service.listByClub(42, {});

      expect(result.items[0].actor).toEqual({
        user_id: 'deleted-user-uuid',
        name: null,
        paternal_last_name: null,
      });
    });

    it('passes cursor as lt filter', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([]);
      mockPrisma.users.findMany.mockResolvedValue([]);

      await service.listByClub(42, { cursor: 100n });

      expect(mockPrisma.audit_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_id: 42,
            audit_log_id: { lt: 100n },
          }),
        }),
      );
    });

    it('caps limit at 100', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([]);
      mockPrisma.users.findMany.mockResolvedValue([]);

      await service.listByClub(42, { limit: 9999 });

      expect(mockPrisma.audit_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 101 }), // 100 + 1 lookahead
      );
    });
  });
});
