import { ErrorCode } from '../common/errors/error-codes';
import { LocalFieldDashboardService } from './local-field-dashboard.service';

const profile = (roles: string[], scope: Record<string, unknown> = {}) =>
  ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: ['reports:read'],
          scope: {},
        })),
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { scope: { global: scope } },
    },
  }) as any;

const DIVISION = { division: { id: 5, name: 'DIA' } };

function setup(resolved: any, fieldInScope: boolean) {
  const prisma: any = {
    local_fields: {
      findFirst: jest
        .fn()
        .mockResolvedValue(fieldInScope ? { local_field_id: 7 } : null),
    },
  };
  const auth: any = {
    resolveUserAuthorization: jest.fn().mockResolvedValue(resolved),
  };
  const service = new LocalFieldDashboardService(prisma, auth, {} as any);
  const compute = jest
    .spyOn(service as any, 'computeDashboard')
    .mockResolvedValue({ local_field_id: 7 });
  return { service, prisma, compute };
}

describe('LocalFieldDashboardService division scope', () => {
  it('a division actor reads a local field of its division', async () => {
    const { service, prisma, compute } = setup(
      profile(['director-dia'], DIVISION),
      true,
    );

    await service.getDashboard('dia-user', 7);

    expect(prisma.local_fields.findFirst).toHaveBeenCalledWith({
      where: { local_field_id: 7, unions: { division_id: 5 } },
      select: { local_field_id: true },
    });
    expect(compute).toHaveBeenCalledWith(7);
  });

  it('a division actor is rejected for a local field of another division', async () => {
    const { service, compute } = setup(
      profile(['assistant-dia'], DIVISION),
      false,
    );

    await expect(service.getDashboard('dia-user', 99)).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    expect(compute).not.toHaveBeenCalled();
  });

  it('a division actor must name a local field (no implicit pick)', async () => {
    const { service, prisma } = setup(
      profile(['director-dia'], DIVISION),
      true,
    );

    await expect(service.getDashboard('dia-user')).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    expect(prisma.local_fields.findFirst).not.toHaveBeenCalled();
  });

  it('a division actor without a derivable division is ADMIN_USER_SCOPE_MISSING', async () => {
    const { service } = setup(profile(['director-dia']), true);

    await expect(service.getDashboard('dia-user', 7)).rejects.toMatchObject({
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
  });

  it('platform admins read any local field without a lookup', async () => {
    const { service, prisma, compute } = setup(profile(['admin']), false);

    await service.getDashboard('admin-user', 99);

    expect(prisma.local_fields.findFirst).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledWith(99);
  });

  it('a union actor keeps checking the field against its union (unchanged)', async () => {
    const { service, prisma } = setup(
      profile(['director-union'], { union: { id: 20, name: 'U' } }),
      true,
    );

    await service.getDashboard('union-user', 7);

    expect(prisma.local_fields.findFirst).toHaveBeenCalledWith({
      where: { local_field_id: 7, union_id: 20 },
      select: { local_field_id: true },
    });
  });

  it('a local field actor stays on its own field (unchanged)', async () => {
    const { service, compute } = setup(
      profile(['director-lf'], { local_field: { id: 7, name: 'C' } }),
      true,
    );

    await service.getDashboard('lf-user', 99);

    expect(compute).toHaveBeenCalledWith(7);
  });
});
