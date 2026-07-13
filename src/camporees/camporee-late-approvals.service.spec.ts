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
  const service = new (CamporeeLateApprovalsService as any)(
    prisma,
    lifecyclePolicy,
  );

  beforeEach(() => jest.clearAllMocks());

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
