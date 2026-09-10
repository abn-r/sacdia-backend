import { Test, TestingModule } from '@nestjs/testing';
import {
  YearCutCronService,
  YEAR_CUT_JOB_NAME,
  YEAR_CUT_LOCK_KEY,
} from './year-cut-cron.service';
import { YearCutService } from './year-cut.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

describe('YearCutCronService', () => {
  let service: YearCutCronService;
  let yearCut: { applyCut: jest.Mock };
  let lockService: { tryAcquire: jest.Mock; release: jest.Mock };
  let cronLogger: { track: jest.Mock; trackSkipped: jest.Mock };

  beforeEach(async () => {
    yearCut = {
      applyCut: jest.fn().mockResolvedValue({
        ended: 1,
        activated: 1,
        returnedNotEnrolled: 1,
        usersInvalidated: 2,
      }),
    };
    lockService = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    cronLogger = {
      track: jest.fn(async (_name: string, fn: () => Promise<unknown>) =>
        fn(),
      ),
      trackSkipped: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YearCutCronService,
        { provide: YearCutService, useValue: yearCut },
        { provide: DistributedLockService, useValue: lockService },
        { provide: CronRunLogger, useValue: cronLogger },
      ],
    }).compile();

    service = module.get(YearCutCronService);
  });

  it('handleYearCut acquires the lock and runs applyCut', async () => {
    await service.handleYearCut();

    expect(lockService.tryAcquire).toHaveBeenCalledWith(
      YEAR_CUT_LOCK_KEY,
      expect.any(Number),
    );
    expect(cronLogger.track).toHaveBeenCalledWith(
      YEAR_CUT_JOB_NAME,
      expect.any(Function),
    );
    expect(yearCut.applyCut).toHaveBeenCalledTimes(1);
    expect(lockService.release).toHaveBeenCalledWith(YEAR_CUT_LOCK_KEY);
  });

  it('skips applyCut when the distributed lock is not acquired', async () => {
    lockService.tryAcquire.mockResolvedValue(false);

    await service.handleYearCut();

    expect(yearCut.applyCut).not.toHaveBeenCalled();
    expect(cronLogger.trackSkipped).toHaveBeenCalledWith(
      YEAR_CUT_JOB_NAME,
      'lock_not_acquired',
    );
  });

  it('onModuleInit uses the same applyCut path for recovery', async () => {
    await service.onModuleInit();
    expect(yearCut.applyCut).toHaveBeenCalledTimes(1);
  });
});
