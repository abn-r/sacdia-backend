import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceParticipationScoreService } from './attendance-participation-score';

describe('AttendanceParticipationScoreService.calc', () => {
  let svc: AttendanceParticipationScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceParticipationScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(AttendanceParticipationScoreService);
  });

  it('returns average attendance percentage for active members in the year', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ score_pct: 88.504 }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(88.5);
  });

  it('returns 0 when there are no attendance records', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ score_pct: null }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
  });

  it('normalizes out-of-range values defensively', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ score_pct: 130 }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
  });
});
