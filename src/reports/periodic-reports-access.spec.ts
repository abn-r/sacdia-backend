import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRolesGuard } from '../common/guards/global-roles.guard';
import { QuarterlyReportsController } from '../quarterly-reports/quarterly-reports.controller';
import { AnnualReportsController } from '../annual-reports/annual-reports.controller';
import { ErrorCode } from '../common/errors/error-codes';
import {
  isCoordinatorOnlyForPeriodicReports,
  canViewPeriodicReports,
} from '../common/authorization/periodic-reports-access';
import {
  resolvePeriodicReportVisibilityScopeForActor,
  resolveReportVisibilityScope,
  resolveReportVisibilityScopeForActor,
} from './report-visibility-scope';

const profile = (
  roles: string[],
  opts: { club?: boolean; permissions?: string[] } = {},
) =>
  ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: [],
          scope: {},
        })),
        club_assignments: opts.club
          ? [
              {
                assignment_id: 'a1',
                role_name: 'director',
                section: { club_section_id: 22 },
              },
            ]
          : [],
      },
      active_assignment: { assignment_id: opts.club ? 'a1' : null },
      effective: {
        permissions: opts.permissions ?? ['reports:read'],
        scope: { global: { local_field: { id: 7 }, union: { id: 3 } } },
      },
    },
  }) as any;

describe('periodic report visibility (coordinators are out)', () => {
  it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
    '%s only: PERIODIC_REPORTS_FORBIDDEN',
    (role) => {
      expect(() =>
        resolvePeriodicReportVisibilityScopeForActor(profile([role]), {}),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.PERIODIC_REPORTS_FORBIDDEN }),
      );
      expect(isCoordinatorOnlyForPeriodicReports(profile([role]))).toBe(true);
    },
  );

  it('monthly reports and compliance keep the coordinator sections (unchanged)', async () => {
    const scope = await resolveReportVisibilityScopeForActor(
      profile(['coordinator']),
      {},
      async () => [4, 5],
    );
    expect(scope).toEqual({ access: 'club_sections', clubSectionIds: [4, 5] });
    expect(
      resolveReportVisibilityScope(profile(['coordinator']), {}, [4]),
    ).toEqual({ access: 'club_sections', clubSectionIds: [4] });
  });

  it('a coordinator who also holds a club section sees that club section', () => {
    const resolved = profile(['coordinator'], { club: true });
    expect(resolvePeriodicReportVisibilityScopeForActor(resolved, {})).toEqual({
      access: 'club_section',
      clubSectionId: 22,
    });
    expect(isCoordinatorOnlyForPeriodicReports(resolved)).toBe(false);
  });

  it('a coordinator that also holds a territorial role is not coordinator-only', () => {
    const resolved = profile(['coordinator', 'director-lf']);
    expect(isCoordinatorOnlyForPeriodicReports(resolved)).toBe(false);
    expect(resolvePeriodicReportVisibilityScopeForActor(resolved, {})).toEqual({
      access: 'local_field',
      localFieldId: 7,
    });
  });

  it.each([
    ['admin', 'all'],
    ['director-union', 'union'],
    ['director-lf', 'local_field'],
  ])('%s keeps the %s scope', (role, access) => {
    expect(
      resolvePeriodicReportVisibilityScopeForActor(profile([role]), {}),
    ).toMatchObject({ access });
  });

  it('a club director with no coordinator role is unaffected', () => {
    expect(
      resolvePeriodicReportVisibilityScopeForActor(
        profile([], { club: true }),
        {},
      ),
    ).toEqual({ access: 'club_section', clubSectionId: 22 });
  });
});

describe('canViewPeriodicReports (capability reports.view_periodic)', () => {
  it('needs reports:read', () => {
    expect(
      canViewPeriodicReports(profile(['admin'], { permissions: [] })),
    ).toBe(false);
    expect(canViewPeriodicReports(profile(['admin']))).toBe(true);
  });

  it('is false for coordinator-only, true once they hold a club section', () => {
    expect(canViewPeriodicReports(profile(['coordinator']))).toBe(false);
    expect(
      canViewPeriodicReports(profile(['coordinator'], { club: true })),
    ).toBe(true);
  });

  it('is false for someone with neither a territorial role nor a club section', () => {
    expect(canViewPeriodicReports(profile(['pastor']))).toBe(false);
  });
});

describe('regenerate is for global admins only', () => {
  const guardFor = (opts: { superAdmin?: boolean; roles?: string[] }) => {
    const auth = {
      isSuperAdmin: jest.fn().mockResolvedValue(opts.superAdmin ?? false),
      hasAnyGlobalRole: jest
        .fn()
        .mockImplementation(async (_user: string, accepted: string[]) =>
          (opts.roles ?? []).some((role) => accepted.includes(role)),
        ),
    };
    return new GlobalRolesGuard(new Reflector(), auth as any);
  };
  const context = (Controller: any): ExecutionContext =>
    ({
      getHandler: () => Controller.prototype.regenerate,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1' } }) }),
    }) as unknown as ExecutionContext;

  describe.each([
    ['quarterly', QuarterlyReportsController],
    ['annual', AnnualReportsController],
  ])('%s', (_name, Controller) => {
    it.each([
      'director-lf',
      'assistant-lf',
      'director-union',
      'director-dia',
      'assistant-admin',
      'coordinator',
    ])('%s gets 403 GUARD_PERMISSION_DENIED', async (role) => {
      await expect(
        guardFor({ roles: [role] }).canActivate(context(Controller)),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('admin passes', async () => {
      await expect(
        guardFor({ roles: ['admin'] }).canActivate(context(Controller)),
      ).resolves.toBe(true);
    });

    it('super-admin passes', async () => {
      await expect(
        guardFor({ superAdmin: true }).canActivate(context(Controller)),
      ).resolves.toBe(true);
    });
  });
});
