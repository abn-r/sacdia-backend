import {
  FINANCE_REMINDER_ROLES,
  FINANCE_REMINDER_SOURCE,
  FINANCE_REMINDER_TITLE,
  FinanceReminderService,
  financeReminderPeriod,
} from './finance-reminder.service';
import { BackgroundJobName } from '../background-jobs/background-jobs.types';
import { getCategoryForSource } from '../notifications/notification-source-map.constants';

describe('FinanceReminderService', () => {
  const mockPrisma = {
    club_sections: { findMany: jest.fn() },
    finances: { groupBy: jest.fn() },
    notification_logs: { findMany: jest.fn() },
  };
  const mockNotifications = { sendToSectionRole: jest.fn() };
  const mockLock = { tryAcquire: jest.fn(), release: jest.fn() };
  const mockCronLogger = { track: jest.fn(), trackSkipped: jest.fn() };
  const mockQueue = { add: jest.fn() };

  const section = (id: number, club: string, type: string) => ({
    club_section_id: id,
    clubs: { name: club },
    club_types: { name: type },
  });

  const build = (queue: unknown = null) =>
    new FinanceReminderService(
      mockPrisma as any,
      mockNotifications as any,
      mockLock as any,
      mockCronLogger as any,
      queue as any,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    mockCronLogger.track.mockImplementation(
      async (_key: string, fn: () => Promise<unknown>) => fn(),
    );
    mockLock.tryAcquire.mockResolvedValue(true);
    mockPrisma.finances.groupBy.mockResolvedValue([]);
    mockPrisma.notification_logs.findMany.mockResolvedValue([]);
    mockNotifications.sendToSectionRole.mockResolvedValue(undefined);
  });

  describe('runMonthEndReminders', () => {
    it('notifies only active sections with no movement in the month', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([
        section(163, 'Estella', 'Aventureros'),
        section(166, 'Panteras', 'Conquistadores'),
        section(170, 'Alfa', 'Guías Mayores'),
      ]);
      mockPrisma.finances.groupBy.mockResolvedValue([{ club_section_id: 166 }]);

      const result = await build().runMonthEndReminders(2026, 11);

      expect(result).toEqual({ itemsProcessed: 2 });
      expect(
        mockNotifications.sendToSectionRole.mock.calls.map((c) => c[0]),
      ).toEqual([163, 170]);
    });

    it('selects active sections of active clubs and counts only active movements of the month', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([]);

      await build().runMonthEndReminders(2026, 11);

      expect(mockPrisma.club_sections.findMany.mock.calls[0][0].where).toEqual({
        active: true,
        main_club_id: { not: null },
        clubs: { is: { active: true } },
      });

      mockPrisma.club_sections.findMany.mockResolvedValue([
        section(1, 'A', 'B'),
      ]);
      await build().runMonthEndReminders(2026, 11);
      expect(mockPrisma.finances.groupBy.mock.calls[0][0].where).toEqual({
        active: true,
        year: 2026,
        month: 11,
        club_section_id: { in: [1] },
      });
    });

    it('sends push + inbox through sendToSectionRole to treasurer, secretary-treasurer and director', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([
        section(163, 'Estella', 'Aventureros'),
      ]);

      await build().runMonthEndReminders(2026, 11);

      expect(mockNotifications.sendToSectionRole).toHaveBeenCalledWith(
        163,
        ['treasurer', 'secretary-treasurer', 'director'],
        'Registra tus movimientos del mes',
        'Estella (Aventureros) aún no tiene movimientos de noviembre. Se cierra automáticamente el día 1.',
        {
          type: 'finances_reminder',
          club_section_id: '163',
          year: '2026',
          month: '11',
        },
        'finances:reminder',
      );
      expect([...FINANCE_REMINDER_ROLES]).toEqual([
        'treasurer',
        'secretary-treasurer',
        'director',
      ]);
      expect(FINANCE_REMINDER_TITLE).toBe('Registra tus movimientos del mes');
    });

    it('is idempotent: a section already reminded this month is skipped', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([
        section(163, 'Estella', 'Aventureros'),
        section(170, 'Alfa', 'Guías Mayores'),
      ]);
      mockPrisma.notification_logs.findMany.mockResolvedValue([
        { target_id: '163' },
      ]);

      const result = await build().runMonthEndReminders(2026, 11);

      expect(result).toEqual({ itemsProcessed: 1 });
      expect(
        mockNotifications.sendToSectionRole.mock.calls.map((c) => c[0]),
      ).toEqual([170]);
      expect(mockPrisma.notification_logs.findMany).toHaveBeenCalledWith({
        where: {
          source: 'finances:reminder',
          target_type: 'section_role',
          target_id: { in: ['163', '170'] },
          created_at: { gte: new Date('2026-11-01T00:00:00.000Z') },
        },
        select: { target_id: true },
        distinct: ['target_id'],
      });
    });

    it('a second run with every section already reminded sends nothing', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([
        section(163, 'Estella', 'Aventureros'),
      ]);
      mockPrisma.notification_logs.findMany.mockResolvedValue([
        { target_id: '163' },
      ]);

      await expect(build().runMonthEndReminders(2026, 11)).resolves.toEqual({
        itemsProcessed: 0,
      });
      expect(mockNotifications.sendToSectionRole).not.toHaveBeenCalled();
    });

    it('runs inside the cron run logger', async () => {
      mockPrisma.club_sections.findMany.mockResolvedValue([]);

      await build().runMonthEndReminders(2026, 11);

      expect(mockCronLogger.track).toHaveBeenCalledWith(
        'finance-month-end-reminder',
        expect.any(Function),
      );
    });
  });

  describe('handleMonthEndReminder (cron)', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-25T16:00:00Z'));
      mockPrisma.club_sections.findMany.mockResolvedValue([]);
    });
    afterEach(() => jest.useRealTimers());

    it('enqueues one job per month with retries when the queue exists', async () => {
      await build(mockQueue).handleMonthEndReminder();

      expect(mockQueue.add).toHaveBeenCalledWith(
        BackgroundJobName.FINANCE_REMINDER,
        expect.objectContaining({ year: 2026, month: 11 }),
        expect.objectContaining({
          jobId: 'finance-reminder-2026-11',
          attempts: 3,
        }),
      );
      expect(mockPrisma.club_sections.findMany).not.toHaveBeenCalled();
    });

    it('falls back to running inline under a lock when there is no queue', async () => {
      await build(null).handleMonthEndReminder();

      expect(mockLock.tryAcquire).toHaveBeenCalled();
      expect(mockPrisma.club_sections.findMany).toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('skips when another instance holds the lock', async () => {
      mockLock.tryAcquire.mockResolvedValue(false);

      await build(null).handleMonthEndReminder();

      expect(mockCronLogger.trackSkipped).toHaveBeenCalledWith(
        'finance-month-end-reminder',
        'lock_not_acquired',
      );
      expect(mockPrisma.club_sections.findMany).not.toHaveBeenCalled();
    });
  });

  describe('financeReminderPeriod', () => {
    it('uses Mexico City time, not UTC', () => {
      // 2026-12-01 03:00 UTC is still 30 Nov 21:00 in Mexico City.
      expect(financeReminderPeriod(new Date('2026-12-01T03:00:00Z'))).toEqual({
        year: 2026,
        month: 11,
      });
      expect(financeReminderPeriod(new Date('2026-11-25T16:00:00Z'))).toEqual({
        year: 2026,
        month: 11,
      });
    });
  });

  describe('registration', () => {
    it('the source is mapped to the reminders category', () => {
      expect(FINANCE_REMINDER_SOURCE).toBe('finances:reminder');
      expect(getCategoryForSource(FINANCE_REMINDER_SOURCE)).toBe('reminders');
    });
  });
});
