import { CamporeeLateApprovalsService } from './camporee-late-approvals.service';

describe('CamporeeLateApprovalsService', () => {
  const transaction = {
    camporee_clubs: { findFirst: jest.fn(), update: jest.fn() },
    local_camporees: { findUnique: jest.fn() },
    union_camporees: { findUnique: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  };
  const lifecyclePolicy = {
    resolveClubRegistrationDisposition: jest.fn(),
  };
  const camporeesService = {
    buildUnionCamporeeScopeWhere: jest.fn(),
  };
  const service = new (CamporeeLateApprovalsService as any)(
    prisma,
    lifecyclePolicy,
    camporeesService,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('countUnionPending', () => {
    const countPrisma = prisma as any;
    countPrisma.camporee_clubs = { count: jest.fn() };
    countPrisma.camporee_members = { count: jest.fn() };
    countPrisma.camporee_payments = { count: jest.fn() };
    const authorization = { grants: {} } as any;

    it('sums clubs, members and payments through the shared territorial scope', async () => {
      camporeesService.buildUnionCamporeeScopeWhere.mockReturnValue({
        union_id: 7,
      });
      countPrisma.camporee_clubs.count.mockResolvedValue(2);
      countPrisma.camporee_members.count.mockResolvedValue(3);
      countPrisma.camporee_payments.count.mockResolvedValue(4);

      await expect(service.countUnionPending(authorization)).resolves.toBe(9);

      expect(
        camporeesService.buildUnionCamporeeScopeWhere,
      ).toHaveBeenCalledWith(authorization);
      const scoped = { union_id: 7, active: true };
      expect(countPrisma.camporee_clubs.count).toHaveBeenCalledWith({
        where: {
          status: 'pending_approval',
          active: true,
          union_camporees: scoped,
        },
      });
      expect(countPrisma.camporee_members.count).toHaveBeenCalledWith({
        where: {
          status: 'pending_approval',
          active: true,
          union_camporees: scoped,
        },
      });
      expect(countPrisma.camporee_payments.count).toHaveBeenCalledWith({
        where: {
          status: 'pending_approval',
          camporee_member: { union_camporees: scoped },
        },
      });
    });

    it('excludes out-of-territory rows by delegating the division scope filter', async () => {
      camporeesService.buildUnionCamporeeScopeWhere.mockReturnValue({
        unions: { division_id: 3 },
      });
      countPrisma.camporee_clubs.count.mockResolvedValue(0);
      countPrisma.camporee_members.count.mockResolvedValue(0);
      countPrisma.camporee_payments.count.mockResolvedValue(0);

      await expect(service.countUnionPending(authorization)).resolves.toBe(0);
      expect(countPrisma.camporee_clubs.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          union_camporees: { unions: { division_id: 3 }, active: true },
        }),
      });
    });
  });

  it('does not approve a late club enrollment before registration opens', async () => {
    transaction.camporee_clubs.findFirst.mockResolvedValue({
      camporee_id: 1,
      union_camporee_id: null,
    });
    transaction.local_camporees.findUnique.mockResolvedValue({
      start_date: new Date('2026-07-10T00:00:00.000Z'),
      end_date: new Date('2026-07-12T00:00:00.000Z'),
      club_registration_opens_at: new Date('2026-07-01T15:00:00.000Z'),
      club_registration_deadline: new Date('2026-07-09T23:59:59.000Z'),
      member_registration_deadline: null,
      payment_deadline: null,
      club_registration_closed_at: null,
      timezone: 'America/Mexico_City',
      timezone_verified_at: null,
    });
    lifecyclePolicy.resolveClubRegistrationDisposition.mockReturnValue(
      'not_open_yet',
    );

    await expect(
      service.approveClubEnrollment(1, 'actor-id'),
    ).rejects.toThrow();
    expect(transaction.camporee_clubs.update).not.toHaveBeenCalled();
  });
});
