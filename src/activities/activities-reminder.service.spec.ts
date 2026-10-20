import { ActivitiesReminderService } from './activities-reminder.service';

const PENDING_TEEN = 'pending-teen';
const ENROLLED_MEMBER = 'enrolled-member';
const BOARD_MEMBER = 'board-member';

describe('ActivitiesReminderService class reminder (club data recipients)', () => {
  const mockPrisma = {
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({ year_id: 1 }),
    },
    club_role_assignments: { findMany: jest.fn() },
    enrollments: { findMany: jest.fn() },
  };
  const mockNotifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
  };
  const mockClubDataRecipients = {
    // Denies the pending teen only.
    filterClubDataRecipients: jest.fn((ids: string[]) =>
      Promise.resolve([...new Set(ids)].filter((id) => id !== PENDING_TEEN)),
    ),
  };

  const payload = {
    title: 'Tu actividad está por comenzar',
    body: 'Clase empieza a las 10:00',
    data: { type: 'activity', entity_id: '9', action: 'reminder' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.club_role_assignments.findMany
      // members of the section
      .mockResolvedValueOnce([
        { user_id: PENDING_TEEN },
        { user_id: ENROLLED_MEMBER },
        { user_id: BOARD_MEMBER },
      ])
      // board members
      .mockResolvedValueOnce([{ user_id: BOARD_MEMBER }]);
    mockPrisma.enrollments.findMany.mockResolvedValue([
      { user_id: PENDING_TEEN },
      { user_id: ENROLLED_MEMBER },
    ]);
  });

  it('reminds enrolled members and the board but not a pending teen, with ONE gate call', async () => {
    const service = new ActivitiesReminderService(
      mockPrisma as any,
      mockNotifications as any,
      mockClubDataRecipients as any,
      {} as any,
      {} as any,
    );

    await (service as any).sendClassReminder(5, [11], payload);

    const notified = mockNotifications.sendToUser.mock.calls.map(
      (c) => c[0].userId,
    );
    expect(notified.sort()).toEqual([BOARD_MEMBER, ENROLLED_MEMBER].sort());
    expect(
      mockClubDataRecipients.filterClubDataRecipients,
    ).toHaveBeenCalledTimes(1);
  });
});
