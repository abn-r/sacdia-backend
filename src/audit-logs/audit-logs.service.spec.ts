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

    describe('acting-for attribution', () => {
      const actingFor = {
        actorUserId: 'guardian-1',
        subjectUserId: 'dependent-1',
        guardianshipId: 'gs-1',
        kind: 'guardian_acting' as const,
      };

      const withActingFor = <T>(fn: () => Promise<T>): Promise<T> =>
        runWithAuditContext(async () => {
          const context = getAuditContext();
          if (context) context.actingFor = actingFor;
          return fn();
        });

      beforeEach(() => {
        mockPrisma.audit_logs.create.mockResolvedValue({ audit_log_id: 3n });
      });

      it('attributes the row to the guardian and targets the dependent when the actor is the subject', async () => {
        await withActingFor(() =>
          service.recordEvent({
            entity_type: 'users',
            entity_id: 'dependent-1',
            action: 'UPDATED',
            actor_user_id: 'dependent-1',
            actor_kind: 'user',
            request_context: { method: 'PATCH' },
          }),
        );

        expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            actor_user_id: 'guardian-1',
            actor_kind: 'guardian_acting',
            target_user_id: 'dependent-1',
            request_context: {
              method: 'PATCH',
              acting_for: {
                guardian_user_id: 'guardian-1',
                dependent_user_id: 'dependent-1',
                guardianship_id: 'gs-1',
              },
            },
          }),
        });
      });

      it('attributes a row that has no actor', async () => {
        await withActingFor(() =>
          service.recordEvent({
            entity_type: 'users',
            entity_id: 'dependent-1',
            action: 'UPDATED',
          }),
        );

        expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            actor_user_id: 'guardian-1',
            actor_kind: 'guardian_acting',
            target_user_id: 'dependent-1',
          }),
        });
      });

      it('keeps an explicit target_user_id', async () => {
        await withActingFor(() =>
          service.recordEvent({
            entity_type: 'users',
            entity_id: 'x',
            action: 'UPDATED',
            actor_user_id: 'dependent-1',
            target_user_id: 'someone-else',
          }),
        );

        expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ target_user_id: 'someone-else' }),
        });
      });

      it('does not override a third-party actor (e.g. a director reviewing the dependent)', async () => {
        await withActingFor(() =>
          service.recordEvent({
            entity_type: 'membership_request',
            entity_id: 'a-1',
            action: 'membership_request.approved',
            actor_user_id: 'director-1',
            target_user_id: 'dependent-1',
          }),
        );

        expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            actor_user_id: 'director-1',
            actor_kind: 'user',
            target_user_id: 'dependent-1',
            request_context: expect.anything(),
          }),
        });
        const data = mockPrisma.audit_logs.create.mock.calls[0][0].data;
        expect(data.request_context).not.toHaveProperty('acting_for');
      });

      it('does not re-attribute system events', async () => {
        await withActingFor(() =>
          service.recordEvent({
            entity_type: 'cron',
            entity_id: 'purge',
            action: 'PURGED',
            actor_kind: 'system',
          }),
        );

        const data = mockPrisma.audit_logs.create.mock.calls[0][0].data;
        expect(data.actor_user_id).toBeNull();
        expect(data.actor_kind).toBe('system');
      });

      it('is a no-op outside an acting request', async () => {
        await runWithAuditContext(() =>
          service.recordEvent({
            entity_type: 'users',
            entity_id: 'u',
            action: 'UPDATED',
            actor_user_id: 'u',
          }),
        );

        const data = mockPrisma.audit_logs.create.mock.calls[0][0].data;
        expect(data.actor_user_id).toBe('u');
        expect(data.actor_kind).toBe('user');
        expect(data.target_user_id).toBeNull();
      });
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

  /**
   * Fail-closed variant (verify 2c W3): for events whose absence would be a
   * compliance gap (reads of a minor's consent form), the caller must know the
   * row was not written.
   */
  describe('recordEventOrThrow', () => {
    const event = {
      entity_type: 'guardianship_consent_evidence',
      entity_id: 'ev-1',
      action: 'read',
      actor_user_id: 'director-1',
      target_user_id: 'dependent-1',
    };

    it('rethrows a failed insert instead of swallowing it', async () => {
      mockPrisma.audit_logs.create.mockRejectedValueOnce(new Error('db down'));

      await expect(service.recordEventOrThrow(event)).rejects.toThrow(
        'db down',
      );
    });

    it('writes with the given transaction client, same row shape as recordEvent', async () => {
      const tx = { audit_logs: { create: jest.fn().mockResolvedValue({}) } };

      await service.recordEventOrThrow(event, tx as never);

      expect(mockPrisma.audit_logs.create).not.toHaveBeenCalled();
      expect(tx.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'guardianship_consent_evidence',
          entity_id: 'ev-1',
          action: 'read',
          actor_user_id: 'director-1',
          target_user_id: 'dependent-1',
          result: 'succeeded',
          source: 'service',
          actor_kind: 'user',
        }),
      });
    });

    it('marks the dedup flag like recordEvent', async () => {
      mockPrisma.audit_logs.create.mockResolvedValue({});
      await runWithAuditContext(async () => {
        await service.recordEventOrThrow(event);
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
