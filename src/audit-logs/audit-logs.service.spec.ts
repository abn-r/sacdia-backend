import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAuditContext, runWithAuditContext } from './audit-request-context';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  const mockPrisma = {
    audit_logs: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
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
            correlation_id: null,
            source: 'service',
            result: 'succeeded',
            actor_kind: 'user',
          }),
        }),
      );
    });

    it('persists http-source rows with result and request_context', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 3n });

      await service.recordEvent({
        entity_type: 'clubs',
        entity_id: '42',
        action: 'UPDATED',
        source: 'http',
        result: 'failed',
        actor_kind: 'anonymous',
        request_context: { method: 'PATCH', status_code: 403 },
      });

      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'http',
            result: 'failed',
            actor_kind: 'anonymous',
            request_context: { method: 'PATCH', status_code: 403 },
          }),
        }),
      );
    });

    it('fills correlation_id from the ambient audit context', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 4n });
      const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

      await runWithAuditContext(
        () =>
          service.recordEvent({
            entity_type: 'club',
            entity_id: '1',
            action: 'CREATED',
          }),
        id,
      );

      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ correlation_id: id }),
        }),
      );
    });

    it('marks the dedup flag for service events but not for http rows', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 5n });

      await runWithAuditContext(async () => {
        await service.recordEvent({
          entity_type: 'clubs',
          entity_id: '1',
          action: 'CREATED',
          source: 'http',
        });
        expect(getAuditContext()?.explicitAuditRecorded).toBe(false);

        await service.recordEvent({
          entity_type: 'club',
          entity_id: '1',
          action: 'CREATED',
        });
        expect(getAuditContext()?.explicitAuditRecorded).toBe(true);
      });
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

  describe('listAdmin', () => {
    const makeRow = (id: bigint) => ({
      audit_log_id: id,
      entity_type: 'club',
      entity_id: '42',
      action: 'CREATED',
      result: 'succeeded',
      source: 'service',
      summary: 'Club creado',
      club_id: 42,
      correlation_id: null,
      actor_user_id: null,
      created_at: new Date('2026-08-23T10:00:00Z'),
    });

    it('does not persist rows and omits changes from the list select', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([makeRow(3n)]);
      mockPrisma.users.findMany.mockResolvedValue([]);

      const result = await service.listAdmin({
        entity_type: 'club',
        from: '2026-08-01',
        to: '2026-08-23',
        limit: 50,
      });

      expect(mockPrisma.audit_logs.create).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({
        audit_log_id: '3',
        result: 'succeeded',
        source: 'service',
        club_id: 42,
      });
      expect(result.items[0]).not.toHaveProperty('changes');
      expect(result.items[0]).not.toHaveProperty('request_context');
      expect(mockPrisma.audit_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entity_type: 'club',
            created_at: {
              gte: new Date('2026-08-01T00:00:00.000Z'),
              lte: new Date('2026-08-23T23:59:59.999Z'),
            },
          }),
          select: expect.not.objectContaining({
            changes: true,
            request_context: true,
          }),
        }),
      );
    });

    it('applies cursor as exclusive upper id bound', async () => {
      mockPrisma.audit_logs.findMany.mockResolvedValue([]);
      mockPrisma.users.findMany.mockResolvedValue([]);

      await service.listAdmin({ cursor: '100' });

      expect(mockPrisma.audit_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ audit_log_id: { lt: 100n } }),
        }),
      );
    });
  });

  describe('getById', () => {
    it('returns changes and request_context without writing', async () => {
      mockPrisma.audit_logs.findUnique.mockResolvedValue({
        audit_log_id: 9n,
        entity_type: 'club',
        entity_id: '42',
        action: 'UPDATED',
        result: 'succeeded',
        source: 'service',
        summary: 'Nombre',
        club_id: 42,
        correlation_id: null,
        actor_user_id: null,
        created_at: new Date('2026-08-23T10:00:00Z'),
        changes: { name: { from: 'A', to: 'B' } },
        request_context: { method: 'PATCH' },
      });
      mockPrisma.users.findMany.mockResolvedValue([]);

      const result = await service.getById('9');

      expect(mockPrisma.audit_logs.create).not.toHaveBeenCalled();
      expect(result.changes).toEqual({ name: { from: 'A', to: 'B' } });
      expect(result.request_context).toEqual({ method: 'PATCH' });
    });

    it('throws RECORD_NOT_FOUND for a missing or non-numeric id', async () => {
      await expect(service.getById('abc')).rejects.toMatchObject({
        code: 'RECORD_NOT_FOUND',
      });
      expect(mockPrisma.audit_logs.findUnique).not.toHaveBeenCalled();

      mockPrisma.audit_logs.findUnique.mockResolvedValue(null);
      await expect(service.getById('99')).rejects.toMatchObject({
        code: 'RECORD_NOT_FOUND',
      });
    });
  });
});
