import { InvestitureReminderCron } from './investiture-reminder.cron';

describe('InvestitureReminderCron', () => {
  it('still delivers pending reminders when one field fails', async () => {
    const communications = {
      dispatchReminders: jest.fn().mockRejectedValue(new Error('field down')),
      deliverPending: jest.fn().mockResolvedValue(1),
    };
    const cron = new InvestitureReminderCron(
      communications as never,
      {
        tryAcquire: async () => true,
        release: async () => undefined,
      } as never,
      {
        track: async (
          _name: string,
          work: () => Promise<{ itemsProcessed: number }>,
        ) => work(),
        trackSkipped: async () => undefined,
      } as never,
    );

    await cron.handle();

    expect(communications.deliverPending).toHaveBeenCalledTimes(1);
  });
});
