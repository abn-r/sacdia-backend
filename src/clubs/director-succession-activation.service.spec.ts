import { DirectorSuccessionActivationService } from './director-succession-activation.service';

describe('DirectorSuccessionActivationService', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');

  const duePlan = {
    succession_id: 'plan-due',
    club_section_id: 11,
    outgoing_assignment_id: 'asg-out',
    successor_user_id: 'user-successor',
    target_ecclesiastical_year_id: 2026,
    status: 'scheduled',
    effective_date: new Date('2026-10-01T00:00:00.000Z'),
    scheduled_by_id: 'user-sched',
    scheduled_by_role: 'union_admin',
    scheduled_local_field_id: 7,
    version: 1,
  };

  function build(opts?: {
    duePlans?: Array<{ succession_id: string }>;
    auditWrite?: jest.Mock;
  }) {
    const updates: unknown[] = [];
    const creates: unknown[] = [];
    const planUpdates: unknown[] = [];
    const auditWrite =
      opts?.auditWrite ??
      jest.fn().mockResolvedValue({ auditLogId: 1n, replayed: false });

    const queryRaw = jest.fn().mockResolvedValue([duePlan]);
    const tx = {
      $queryRaw: queryRaw,
      director_succession_plans: {
        update: jest.fn(async (args: unknown) => {
          planUpdates.push(args);
          return { ...duePlan, status: 'activated' };
        }),
      },
      club_role_assignments: {
        findUnique: jest.fn().mockResolvedValue({
          assignment_id: 'asg-out',
          user_id: 'user-outgoing',
          club_section_id: 11,
          role_id: 'role-director',
          active: true,
          roles: { role_name: 'director' },
        }),
        update: jest.fn(async (args: unknown) => {
          updates.push(args);
          return {
            assignment_id: 'asg-out',
            user_id: 'user-outgoing',
          };
        }),
        create: jest.fn(async (args: unknown) => {
          creates.push(args);
          return {
            assignment_id: 'asg-new',
            user_id: 'user-successor',
          };
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      roles: {
        findFirst: jest.fn().mockResolvedValue({
          role_id: 'role-director',
        }),
      },
    };

    const prisma = {
      director_succession_plans: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts?.duePlans ?? [{ succession_id: 'plan-due' }]),
      },
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => {
          try {
            return await fn(tx);
          } catch (error) {
            creates.length = 0;
            updates.length = 0;
            planUpdates.length = 0;
            throw error;
          }
        },
      ),
    };

    const audit = { write: auditWrite };
    const version = {
      bumpOrdered: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DirectorSuccessionActivationService(
      prisma as never,
      audit as never,
      version as never,
    );

    return {
      service,
      prisma,
      creates,
      updates,
      planUpdates,
      auditWrite,
      version,
      queryRaw,
    };
  }

  it('activates a due scheduled succession once', async () => {
    const { service, prisma, creates, planUpdates, auditWrite, version, queryRaw } =
      build();

    const first = await service.activateDue(now);
    expect(first).toEqual({ activated: 1 });
    expect(creates).toHaveLength(1);
    const lockSql = queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect((lockSql?.strings ?? []).join('?')).toContain('FOR UPDATE');
    expect(planUpdates.some((u) => {
      const data = (u as { data?: { status?: string } }).data;
      return data?.status === 'activated';
    })).toBe(true);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'DIRECTOR_SUCCESSION_ACTIVATED',
        entityId: 'plan-due',
      }),
    );
    expect(version.bumpOrdered).toHaveBeenCalled();

    prisma.director_succession_plans.findMany.mockResolvedValueOnce([]);
    const second = await service.activateDue(now);
    expect(second).toEqual({ activated: 0 });
  });

  it('rolls back when critical audit write fails', async () => {
    const auditWrite = jest
      .fn()
      .mockRejectedValue(new Error('audit unavailable'));
    const { service, creates, updates, planUpdates } = build({ auditWrite });

    await expect(service.activateDue(now)).rejects.toThrow('audit unavailable');
    expect(auditWrite).toHaveBeenCalled();
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(planUpdates).toHaveLength(0);
  });

  it('does not mutate roles for a future succession', async () => {
    const { service, prisma, creates, updates, planUpdates, auditWrite } =
      build({ duePlans: [] });

    const result = await service.activateDue(now);
    expect(result).toEqual({ activated: 0 });
    expect(prisma.director_succession_plans.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'scheduled',
          effective_date: { lte: now },
        }),
      }),
    );
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(planUpdates).toHaveLength(0);
    expect(auditWrite).not.toHaveBeenCalled();
  });
});
