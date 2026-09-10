import { Test, TestingModule } from '@nestjs/testing';
import { EcclesiasticalYearService } from './ecclesiastical-year.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import { ErrorCode } from '../errors/error-codes';
import { CLOCK } from '../clock/clock';

describe('EcclesiasticalYearService', () => {
  let service: EcclesiasticalYearService;
  let prisma: { ecclesiastical_years: { findMany: jest.Mock } };
  let zonedTime: { businessDate: jest.Mock };
  let mockClock: { now: jest.Mock };

  beforeEach(async () => {
    prisma = { ecclesiastical_years: { findMany: jest.fn() } };
    zonedTime = { businessDate: jest.fn() };
    mockClock = {
      now: jest.fn().mockReturnValue(new Date('2026-09-08T12:00:00.000Z')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EcclesiasticalYearService,
        { provide: PrismaService, useValue: prisma },
        { provide: ZonedBusinessTimeService, useValue: zonedTime },
        { provide: CLOCK, useValue: mockClock },
      ],
    }).compile();

    service = module.get<EcclesiasticalYearService>(EcclesiasticalYearService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the current ecclesiastical year when date is within range', async () => {
    const now = new Date('2026-04-15T12:00:00.000Z');
    zonedTime.businessDate.mockReturnValue('2026-04-15');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 5,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
        modified_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getCurrentYear(now);

    expect(result.year_id).toBe(5);
    expect(zonedTime.businessDate).toHaveBeenCalledWith(
      now,
      'America/Mexico_City',
    );
    expect(prisma.ecclesiastical_years.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          start_date: { lte: new Date('2026-04-15') },
          end_date: { gte: new Date('2026-04-15') },
        }),
      }),
    );
  });

  it('A08/R08: uses America/Mexico_City so UTC midnight is still the previous local date', async () => {
    const nowJustAfterMidnightUtc = new Date('2026-01-01T05:30:00.000Z');
    zonedTime.businessDate.mockReturnValue('2025-12-31');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([]);

    await expect(
      service.getCurrentYear(nowJustAfterMidnightUtc),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND });

    expect(zonedTime.businessDate).toHaveBeenCalledWith(
      nowJustAfterMidnightUtc,
      'America/Mexico_City',
    );
    expect(prisma.ecclesiastical_years.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          start_date: { lte: new Date('2025-12-31') },
          end_date: { gte: new Date('2025-12-31') },
        }),
      }),
    );
  });

  it('A09: throws CLASS_ACTIVE_YEAR_NOT_FOUND when no row covers the current date', async () => {
    zonedTime.businessDate.mockReturnValue('2026-07-01');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([]);

    await expect(service.getCurrentYear()).rejects.toMatchObject({
      code: ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND,
    });
  });

  it('uses clock.now() as the default instant when no argument is provided', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00.000Z');
    mockClock.now.mockReturnValue(fixedNow);
    zonedTime.businessDate.mockReturnValue('2026-09-08');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([]);

    await expect(service.getCurrentYear()).rejects.toMatchObject({
      code: ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND,
    });

    expect(mockClock.now).toHaveBeenCalledTimes(1);
    const called = zonedTime.businessDate.mock.calls[0][0] as Date;
    expect(called).toBe(fixedNow);
  });

  it('R08: a year that starts in September is current when the local date is in range', async () => {
    const now = new Date('2025-09-15T18:00:00.000Z');
    zonedTime.businessDate.mockReturnValue('2025-09-15');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2025,
        start_date: new Date('2025-09-01T00:00:00.000Z'),
        end_date: new Date('2026-08-31T00:00:00.000Z'),
        active: false,
        modified_at: new Date('2025-08-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getCurrentYear(now);
    expect(result.year_id).toBe(2025);
    expect(prisma.ecclesiastical_years.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ active: true }),
      }),
    );
  });

  it('A09: overlapping covering years throw ECCLESIASTICAL_YEAR_AMBIGUOUS', async () => {
    zonedTime.businessDate.mockReturnValue('2026-06-01');
    prisma.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
        modified_at: null,
      },
      {
        year_id: 99,
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
        modified_at: null,
      },
    ]);

    await expect(service.getCurrentYear()).rejects.toMatchObject({
      code: ErrorCode.ECCLESIASTICAL_YEAR_AMBIGUOUS,
    });
  });
});
