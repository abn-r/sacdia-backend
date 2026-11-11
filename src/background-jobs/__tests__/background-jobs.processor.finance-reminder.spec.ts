import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import { BackgroundJobName } from '../background-jobs.types';

describe('BackgroundJobsProcessor — finance reminder', () => {
  const financeReminder = { runMonthEndReminders: jest.fn() };
  const financePeriod = { runMonthlyClosing: jest.fn() };
  let processor: BackgroundJobsProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new BackgroundJobsProcessor(
      {} as never,
      financePeriod as never,
      financeReminder as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('dispatches finance-reminder.month-end to the reminder service only', async () => {
    financeReminder.runMonthEndReminders.mockResolvedValue({
      itemsProcessed: 4,
    });

    const result = await processor.process({
      id: 'job-1',
      name: BackgroundJobName.FINANCE_REMINDER,
      data: { triggeredAt: new Date().toISOString(), year: 2026, month: 11 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job<unknown>);

    expect(financeReminder.runMonthEndReminders).toHaveBeenCalledWith(2026, 11);
    expect(financePeriod.runMonthlyClosing).not.toHaveBeenCalled();
    expect(result).toEqual({ itemsProcessed: 4 });
  });
});
