import { NotFoundException } from '@nestjs/common';
import { MasterHonorsService } from './master-honors.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  users_master_honors: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  user_master_honor_id: 10,
  master_honor_id: 2,
  status: 'AWARDED',
  awarded_at: new Date('2026-06-03T10:00:00.000Z'),
  revoked_at: null,
  recovered_at: null,
  status_reason: null,
  evaluation_snapshot: {
    master_honor_id: 2,
    groups: [],
  },
  master_honor: {
    name: 'Maestría en Acuática',
    master_image: 'https://example.com/a.png',
  },
  ...overrides,
});

describe('MasterHonorsService', () => {
  let service: MasterHonorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MasterHonorsService(mockPrisma as unknown as PrismaService);
  });

  it('lists awarded, revoked, and retired user master honors with current labels', async () => {
    mockPrisma.users_master_honors.findMany.mockResolvedValue([
      makeRecord(),
      makeRecord({
        user_master_honor_id: 11,
        master_honor_id: 3,
        status: 'REVOKED',
        revoked_at: new Date('2026-06-04T10:00:00.000Z'),
        status_reason: 'USER_NO_LONGER_QUALIFIES',
        master_honor: {
          name: 'Maestría en Artesanía',
          master_image: null,
        },
      }),
      makeRecord({
        user_master_honor_id: 12,
        master_honor_id: 4,
        status: 'RETIRED',
        revoked_at: null,
        status_reason: 'MASTER_HONOR_INACTIVE',
        master_honor: {
          name: 'Maestría no activa',
          master_image: null,
        },
      }),
    ]);

    const result = await service.getUserMasterHonors('user-1');

    expect(mockPrisma.users_master_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          active: true,
          status: { in: ['AWARDED', 'REVOKED', 'RETIRED'] },
        }),
        take: 500,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        user_master_honor_id: 10,
        master_honor_id: 2,
        name: 'Maestría en Acuática',
        status: 'AWARDED',
        is_current: true,
        display_status_label: 'Vigente',
        awarded_at: '2026-06-03T10:00:00.000Z',
      }),
      expect.objectContaining({
        user_master_honor_id: 11,
        status: 'REVOKED',
        is_current: false,
        display_status_label: 'No vigente',
        revoked_at: '2026-06-04T10:00:00.000Z',
        status_reason: 'USER_NO_LONGER_QUALIFIES',
      }),
      expect.objectContaining({
        user_master_honor_id: 12,
        status: 'RETIRED',
        is_current: false,
        display_status_label: 'No vigente',
        status_reason: 'MASTER_HONOR_INACTIVE',
      }),
    ]);
    expect(result[0]).not.toHaveProperty('evaluation_snapshot');
  });

  it('returns detail with evaluation snapshot', async () => {
    mockPrisma.users_master_honors.findFirst.mockResolvedValue(
      makeRecord({
        evaluation_snapshot: {
          master_honor_id: 2,
          groups: [{ group_id: 1, passed: true }],
        },
      }),
    );

    const result = await service.getUserMasterHonorDetail('user-1', 2);

    expect(mockPrisma.users_master_honors.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          master_honor_id: 2,
          active: true,
          status: { in: ['AWARDED', 'REVOKED', 'RETIRED'] },
        }),
      }),
    );
    expect(result).toMatchObject({
      user_master_honor_id: 10,
      master_honor_id: 2,
      name: 'Maestría en Acuática',
      evaluation_snapshot: {
        master_honor_id: 2,
        groups: [{ group_id: 1, passed: true }],
      },
    });
  });

  it('throws not found when detail does not exist for the user', async () => {
    mockPrisma.users_master_honors.findFirst.mockResolvedValue(null);

    await expect(
      service.getUserMasterHonorDetail('user-1', 99),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
