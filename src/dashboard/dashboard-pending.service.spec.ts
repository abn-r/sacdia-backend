import { DashboardPendingService } from './dashboard-pending.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TestingClock } from '../common/clock/testing-clock';

const ALL_PERMS = [
  'club_members:approve',
  'evidence_folders:read',
  'reports:submit',
];

function snapshot(permissions: string[], withClub = true) {
  return {
    authorization: {
      grants: {
        global_roles: [],
        direct_permissions: [],
        club_assignments: withClub
          ? [{ assignment_id: 'a-1', permissions }]
          : [],
      },
      active_assignment: { assignment_id: withClub ? 'a-1' : null },
      effective: {
        permissions: [],
        scope: {
          global: {},
          club: withClub
            ? {
                assignment_id: 'a-1',
                role_name: 'x',
                club: { club_id: 1, club_name: 'c' },
                section: { club_section_id: 123, club_type_id: 1 },
              }
            : null,
        },
      },
    },
  };
}

describe('DashboardPendingService', () => {
  // 2026-11-04 12:00 Mexico City
  const clock = new TestingClock(new Date('2026-11-04T18:00:00Z'));

  const prisma = {
    club_enrollments: { findUnique: jest.fn() },
    ecclesiastical_years: { findFirst: jest.fn() },
    annual_folders: { findUnique: jest.fn() },
    annual_folder_section_evaluations: { groupBy: jest.fn() },
    monthly_reports: { findUnique: jest.fn() },
    system_config: { findUnique: jest.fn() },
  };
  const authContext = { resolveUserAuthorization: jest.fn() };
  const catalogs = { getCurrentEcclesiasticalYear: jest.fn() };
  const membershipRequests = { listPending: jest.fn() };
  const investiture = { listForAuthorizer: jest.fn() };

  let service: DashboardPendingService;

  beforeEach(() => {
    jest.resetAllMocks();
    clock.set(new Date('2026-11-04T18:00:00Z'));
    authContext.resolveUserAuthorization.mockResolvedValue(snapshot(ALL_PERMS));
    catalogs.getCurrentEcclesiasticalYear.mockResolvedValue({
      ecclesiastical_year_id: 9,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    });
    prisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enr-1',
      status: 'active',
    });
    prisma.ecclesiastical_years.findFirst.mockResolvedValue({
      year_id: 9,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    });
    prisma.annual_folders.findUnique.mockResolvedValue(null);
    prisma.annual_folder_section_evaluations.groupBy.mockResolvedValue([]);
    prisma.monthly_reports.findUnique.mockResolvedValue({
      status: 'submitted',
    });
    prisma.system_config.findUnique.mockResolvedValue(null);
    membershipRequests.listPending.mockResolvedValue([]);
    investiture.listForAuthorizer.mockRejectedValue(
      new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN),
    );
    service = new DashboardPendingService(
      prisma as never,
      authContext as never,
      catalogs as never,
      membershipRequests as never,
      investiture as never,
      clock,
    );
  });

  const folder = (
    status: string,
    groups: Array<[string, number]>,
    sections = groups.reduce((s, [, n]) => s + n, 0),
  ) => {
    prisma.annual_folders.findUnique.mockResolvedValue({
      annual_folder_id: 'f-1',
      status,
      folder_template: { _count: { sections } },
    });
    prisma.annual_folder_section_evaluations.groupBy.mockResolvedValue(
      groups.map(([s, n]) => ({ status: s, _count: { _all: n } })),
    );
  };

  it('member / counselor with no relevant permission: empty, totals 0', async () => {
    authContext.resolveUserAuthorization.mockResolvedValue(snapshot([]));
    const result = await service.getPending('u1');
    expect(result).toMatchObject({
      section_id: 123,
      total: 0,
      urgent: 0,
      items: [],
    });
    expect(membershipRequests.listPending).not.toHaveBeenCalled();
    expect(prisma.annual_folders.findUnique).not.toHaveBeenCalled();
    expect(prisma.monthly_reports.findUnique).not.toHaveBeenCalled();
  });

  it('no includeClubData (pending teen): empty and never touches authorization', async () => {
    const result = await service.getPending('u1', { includeClubData: false });
    expect(result).toMatchObject({ section_id: null, total: 0, items: [] });
    expect(authContext.resolveUserAuthorization).not.toHaveBeenCalled();
  });

  it('no active club assignment: only the non-section-scoped investiture item can appear', async () => {
    authContext.resolveUserAuthorization.mockResolvedValue(snapshot([], false));
    investiture.listForAuthorizer.mockResolvedValue([
      { pending_count: 2 },
      { pending_count: 5 },
    ]);
    const result = await service.getPending('u1');
    expect(result.section_id).toBeNull();
    expect(result.items).toEqual([
      { type: 'investiture_authorizations', count: 7, severity: 'info' },
    ]);
    expect(result.total).toBe(7);
  });

  describe('membership_requests', () => {
    it('club_members:approve counts every row the list endpoint returns', async () => {
      membershipRequests.listPending.mockResolvedValue([{}, {}, {}]);
      const result = await service.getPending('u1');
      expect(membershipRequests.listPending).toHaveBeenCalledWith(123, 'u1', {
        verifyOnly: false,
      });
      expect(result.items).toContainEqual({
        type: 'membership_requests',
        count: 3,
        severity: 'warning',
      });
    });

    it('consent:verify only: counts what listPending(verifyOnly) returns', async () => {
      authContext.resolveUserAuthorization.mockResolvedValue(
        snapshot(['consent:verify']),
      );
      membershipRequests.listPending.mockResolvedValue([{}, {}]);
      const result = await service.getPending('u1');
      expect(membershipRequests.listPending).toHaveBeenCalledWith(123, 'u1', {
        verifyOnly: true,
      });
      expect(result.items).toEqual([
        { type: 'membership_requests', count: 2, severity: 'warning' },
      ]);
    });

    it('zero count is omitted', async () => {
      const result = await service.getPending('u1');
      expect(
        result.items.find((i) => i.type === 'membership_requests'),
      ).toBeUndefined();
    });

    it('a global/direct permission does not count: only the active assignment grants', async () => {
      const snap = snapshot([]);
      snap.authorization.effective.permissions = ['club_members:approve'];
      snap.authorization.grants.direct_permissions = ['club_members:approve'];
      authContext.resolveUserAuthorization.mockResolvedValue(snap);
      membershipRequests.listPending.mockResolvedValue([{}]);
      const result = await service.getPending('u1');
      expect(result.items).toEqual([]);
      expect(membershipRequests.listPending).not.toHaveBeenCalled();
    });
  });

  describe('evidence_folder', () => {
    it('rejected sections make it urgent', async () => {
      folder('open', [
        ['REJECTED', 1],
        ['PENDING', 1],
        ['VALIDATED', 2],
      ]);
      const result = await service.getPending('u1');
      expect(result.items).toEqual([
        {
          type: 'evidence_folder',
          count: 2,
          rejected_count: 1,
          not_submitted_count: 1,
          severity: 'urgent',
        },
      ]);
      expect(result.urgent).toBe(1);
    });

    it('only PENDING sections: warning', async () => {
      folder('open', [
        ['PENDING', 2],
        ['SUBMITTED', 1],
      ]);
      const result = await service.getPending('u1');
      expect(result.items[0]).toMatchObject({
        type: 'evidence_folder',
        count: 2,
        severity: 'warning',
      });
    });

    it('template sections without an evaluation row count as not submitted', async () => {
      folder('open', [['VALIDATED', 1]], 3);
      const result = await service.getPending('u1');
      expect(result.items[0]).toMatchObject({
        not_submitted_count: 2,
        rejected_count: 0,
      });
    });

    it('omitted when the folder does not exist, is closed, or nothing is pending', async () => {
      expect((await service.getPending('u1')).items).toEqual([]);
      folder('closed', [['REJECTED', 1]]);
      expect((await service.getPending('u1')).items).toEqual([]);
      folder('open', [
        ['VALIDATED', 1],
        ['SUBMITTED', 1],
        ['PREAPPROVED_LF', 1],
      ]);
      expect((await service.getPending('u1')).items).toEqual([]);
    });

    it('omitted without evidence_folders:read', async () => {
      authContext.resolveUserAuthorization.mockResolvedValue(
        snapshot(['reports:submit']),
      );
      folder('open', [['REJECTED', 1]]);
      await service.getPending('u1');
      expect(prisma.annual_folders.findUnique).not.toHaveBeenCalled();
    });

    it('omitted when the section has no current-year enrollment', async () => {
      prisma.club_enrollments.findUnique.mockResolvedValue(null);
      folder('open', [['REJECTED', 1]]);
      expect((await service.getPending('u1')).items).toEqual([]);
    });
  });

  describe('monthly_report', () => {
    it('missing report on day 4: previous month, 1 day left, urgent', async () => {
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      const result = await service.getPending('u1');
      expect(prisma.monthly_reports.findUnique).toHaveBeenCalledWith({
        where: {
          club_enrollment_id_month_year: {
            club_enrollment_id: 'enr-1',
            month: 10,
            year: 2026,
          },
        },
        select: { status: true },
      });
      expect(result.items).toEqual([
        {
          type: 'monthly_report',
          count: 1,
          period_month: 10,
          period_year: 2026,
          report_status: 'missing',
          due_date: '2026-11-05',
          days_left: 1,
          severity: 'urgent',
        },
      ]);
    });

    it('overdue (day 20): keeps showing with negative days_left, urgent', async () => {
      clock.set(new Date('2026-11-20T18:00:00Z'));
      prisma.monthly_reports.findUnique.mockResolvedValue({ status: 'draft' });
      const result = await service.getPending('u1');
      expect(result.items[0]).toMatchObject({
        period_month: 10,
        due_date: '2026-11-05',
        days_left: -15,
        report_status: 'draft',
        severity: 'urgent',
      });
    });

    it('day 27: current month, due next month, plenty of time: warning', async () => {
      clock.set(new Date('2026-11-27T18:00:00Z'));
      prisma.monthly_reports.findUnique.mockResolvedValue({ status: 'draft' });
      const result = await service.getPending('u1');
      expect(result.items[0]).toMatchObject({
        period_month: 11,
        due_date: '2026-12-05',
        days_left: 8,
        severity: 'warning',
      });
    });

    it('rejected is urgent even with time left', async () => {
      clock.set(new Date('2026-11-27T18:00:00Z'));
      prisma.monthly_reports.findUnique.mockResolvedValue({
        status: 'rejected',
      });
      const result = await service.getPending('u1');
      expect(result.items[0]).toMatchObject({
        report_status: 'rejected',
        severity: 'urgent',
      });
    });

    it('days_left <= 3 is urgent; reads the configured due day', async () => {
      clock.set(new Date('2026-11-27T18:00:00Z'));
      prisma.system_config.findUnique.mockResolvedValue({ config_value: '10' });
      prisma.monthly_reports.findUnique.mockResolvedValue({
        status: 'generated',
      });
      // due 2026-12-10, today 11-27 => 13 days left
      expect((await service.getPending('u1')).items[0]).toMatchObject({
        days_left: 13,
        due_date: '2026-12-10',
        severity: 'warning',
      });
      clock.set(new Date('2026-11-07T18:00:00Z'));
      // previous month, due 2026-11-10 => 3 days left
      expect((await service.getPending('u1')).items[0]).toMatchObject({
        days_left: 3,
        severity: 'urgent',
      });
    });

    it('invalid configured due day falls back to 5', async () => {
      prisma.system_config.findUnique.mockResolvedValue({ config_value: '40' });
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      expect((await service.getPending('u1')).items[0]).toMatchObject({
        due_date: '2026-11-05',
      });
    });

    it.each(['submitted', 'approved'])('%s is omitted', async (status) => {
      prisma.monthly_reports.findUnique.mockResolvedValue({ status });
      expect((await service.getPending('u1')).items).toEqual([]);
    });

    it('omitted without reports:submit', async () => {
      authContext.resolveUserAuthorization.mockResolvedValue(
        snapshot(['club_members:approve']),
      );
      await service.getPending('u1');
      expect(prisma.monthly_reports.findUnique).not.toHaveBeenCalled();
    });

    it('across a year boundary the enrollment is the one of the period year', async () => {
      // 2027-01-03 Mexico City: period December 2026 belongs to year 9.
      clock.set(new Date('2027-01-03T18:00:00Z'));
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      const result = await service.getPending('u1');
      expect(prisma.ecclesiastical_years.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            start_date: { lte: new Date('2026-12-31T00:00:00Z') },
            end_date: { gte: new Date('2026-12-01T00:00:00Z') },
          },
        }),
      );
      expect(prisma.club_enrollments.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            club_section_id_ecclesiastical_year_id: {
              club_section_id: 123,
              ecclesiastical_year_id: 9,
            },
          },
        }),
      );
      expect(result.items[0]).toMatchObject({
        period_month: 12,
        period_year: 2026,
        due_date: '2027-01-05',
        days_left: 2,
      });
    });

    it('omitted when no ecclesiastical year contains the period', async () => {
      prisma.ecclesiastical_years.findFirst.mockResolvedValue(null);
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      expect((await service.getPending('u1')).items).toEqual([]);
    });

    it('omitted when the section has no enrollment in the period year', async () => {
      prisma.club_enrollments.findUnique.mockResolvedValue(null);
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      expect((await service.getPending('u1')).items).toEqual([]);
    });

    it('omitted for a non-active enrollment', async () => {
      prisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enr-1',
        status: 'inactive',
      });
      prisma.monthly_reports.findUnique.mockResolvedValue(null);
      expect((await service.getPending('u1')).items).toEqual([]);
    });
  });

  describe('investiture_authorizations', () => {
    it('sums pending_count, is info, and is not section-scoped', async () => {
      authContext.resolveUserAuthorization.mockResolvedValue(snapshot([]));
      investiture.listForAuthorizer.mockResolvedValue([
        { pending_count: 3 },
        { pending_count: 4 },
        {},
      ]);
      const result = await service.getPending('u1');
      expect(investiture.listForAuthorizer).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        9,
      );
      expect(result.items).toEqual([
        { type: 'investiture_authorizations', count: 7, severity: 'info' },
      ]);
    });

    it('non-authorizer (forbidden) is silently omitted and not logged as failure', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const result = await service.getPending('u1');
      expect(result.items).toEqual([]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('zero pending is omitted', async () => {
      investiture.listForAuthorizer.mockResolvedValue([{ pending_count: 0 }]);
      expect((await service.getPending('u1')).items).toEqual([]);
    });
  });

  it('orders urgent, then warning, then info, ties in contract order; totals add up', async () => {
    clock.set(new Date('2026-11-20T18:00:00Z'));
    membershipRequests.listPending.mockResolvedValue([{}, {}, {}]);
    folder('open', [['PENDING', 2]]);
    prisma.monthly_reports.findUnique.mockResolvedValue({ status: 'rejected' });
    investiture.listForAuthorizer.mockResolvedValue([{ pending_count: 7 }]);
    const result = await service.getPending('u1');
    expect(result.items.map((i) => i.type)).toEqual([
      'monthly_report',
      'membership_requests',
      'evidence_folder',
      'investiture_authorizations',
    ]);
    expect(result.total).toBe(3 + 2 + 1 + 7);
    expect(result.urgent).toBe(1);
    expect(result.generated_at).toBe('2026-11-20T18:00:00.000Z');
  });

  it('one failing sub-query is logged and omitted; the others are returned', async () => {
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    membershipRequests.listPending.mockRejectedValue(new Error('boom'));
    folder('open', [['REJECTED', 1]]);
    investiture.listForAuthorizer.mockResolvedValue([{ pending_count: 2 }]);
    const result = await service.getPending('u1');
    expect(result.items.map((i) => i.type)).toEqual([
      'evidence_folder',
      'investiture_authorizations',
    ]);
    expect(result.total).toBe(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('membership_requests');
  });

  it('a shared enrollment failure omits both folder and report but keeps the rest', async () => {
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    prisma.club_enrollments.findUnique.mockRejectedValue(new Error('db'));
    membershipRequests.listPending.mockResolvedValue([{}]);
    const result = await service.getPending('u1');
    expect(result.items.map((i) => i.type)).toEqual(['membership_requests']);
  });
});
