import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { MasterHonorsRecalculationProcessor } from './master-honors-recalculation.processor';
import { PrismaService } from '../prisma/prisma.service';
import {
  MasterHonorJob,
} from './master-honors.constants';
import {
  master_honor_requirement_group_type_enum,
} from '@prisma/client';

const mockPrismaService: any = {
  master_honors: {
    findUnique: jest.fn(),
  },
  users_honors: {
    findMany: jest.fn(),
  },
  users_master_honors: {
    findMany: jest.fn(),
  },
};

const mockEvaluator = {
  evaluateUser: jest.fn().mockResolvedValue([]),
};

function makeJob<T>(data: T): Job<T> {
  return {
    id: 'job-1',
    name: 'master-honors',
    data,
  } as unknown as Job<T>;
}

describe('MasterHonorsRecalculationProcessor', () => {
  let processor: MasterHonorsRecalculationProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterHonorsRecalculationProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: 'MasterHonorsEvaluatorService', useValue: mockEvaluator },
      ],
    })
      .overrideProvider(MasterHonorsRecalculationProcessor)
      .useFactory({
        factory: () =>
          new MasterHonorsRecalculationProcessor(
            mockPrismaService,
            mockEvaluator as any,
          ),
      })
      .compile();

    processor = module.get<MasterHonorsRecalculationProcessor>(
      MasterHonorsRecalculationProcessor,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('evaluates one user when kind=user', async () => {
    const job = makeJob<MasterHonorJob>({
      kind: 'user',
      userId: 'user-1',
      masterHonorId: 10,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ processed: 1, users: 1 });
    expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith('user-1', {
      masterHonorId: 10,
      jobId: expect.any(String),
    });
  });

  it('recalculates users affected by a specific master honor', async () => {
    mockPrismaService.users_master_honors.findMany.mockResolvedValue([
      { user_id: 'user-existing' },
    ]);

    mockPrismaService.master_honors.findUnique.mockResolvedValue({
      master_honor_id: 12,
      requirement_groups: [
        {
          group_type: master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
          honors_category_id: null,
          options: [
            {
              honors: [
                { honor_id: 11 },
                { honor_id: 12 },
              ],
            },
          ],
        },
        {
          group_type: master_honor_requirement_group_type_enum.CATEGORY_COUNT,
          honors_category_id: 7,
          options: [],
        },
      ],
    });

    mockPrismaService.users_honors.findMany
      .mockResolvedValueOnce([{ user_id: 'user-explicit' }])
      .mockResolvedValueOnce([{ user_id: 'user-category' }]);

    const job = makeJob<MasterHonorJob>({
      kind: 'master-honor',
      masterHonorId: 12,
    });

    const result = await processor.process(job);

    const calledUsers = mockEvaluator.evaluateUser.mock.calls
      .map((call: any[]) => call[0])
      .sort();

    expect(calledUsers).toEqual(
      ['user-existing', 'user-explicit', 'user-category'].sort(),
    );
    for (const userId of calledUsers) {
      expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          masterHonorId: 12,
          jobId: expect.any(String),
        }),
      );
    }

    expect(result).toEqual({
      processed: 3,
      users: 3,
    });
  });

  it('recalculates all users with approved honors for kind=all', async () => {
    mockPrismaService.users_honors.findMany.mockResolvedValue([
      { user_id: 'user-1' },
      { user_id: 'user-2' },
      { user_id: 'user-3' },
    ]);

    mockPrismaService.users_master_honors.findMany.mockResolvedValue([
      { user_id: 'user-2' },
      { user_id: 'user-4' },
    ]);

    const job = makeJob<MasterHonorJob>({
      kind: 'all',
    });

    const result = await processor.process(job);

    expect(mockEvaluator.evaluateUser).toHaveBeenCalledTimes(4);
    expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith('user-1', expect.any(Object));
    expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith('user-2', expect.any(Object));
    expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith('user-3', expect.any(Object));
    expect(mockEvaluator.evaluateUser).toHaveBeenCalledWith('user-4', expect.any(Object));
    expect(result).toEqual({
      processed: 4,
      users: 4,
    });
  });

  it('returns zero when a job kind is not recognized', async () => {
    const job = makeJob<any>({
      kind: 'unknown-kind',
    });

    const result = await processor.process(job);

    expect(result).toEqual({ processed: 0, users: 0 });
    expect(mockEvaluator.evaluateUser).not.toHaveBeenCalled();
  });
});
