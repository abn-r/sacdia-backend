import { Test } from '@nestjs/testing';
import { AnnualRankingsService } from './annual-rankings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';

const LOCAL_FIELD_ID = 4;
const YEAR_ID = 1;
const CLUB_TYPE_ID = 1;

const configRow = {
  max_points: 10000,
  components: [
    {
      component_key: 'annual_folder',
      label: 'Carpeta anual',
      max_points: 6000,
    },
    { component_key: 'finance', label: 'Finanzas', max_points: 2000 },
    { component_key: 'camporee', label: 'Camporee', max_points: 2000 },
  ],
};

const tierRows = [
  { name: 'Diamante', slug: 'diamante', band_percentage: 5, sort_order: 1 },
  { name: 'Oro', slug: 'oro', band_percentage: 10, sort_order: 2 },
  { name: 'Plata', slug: 'plata', band_percentage: 15, sort_order: 3 },
];

function makeRankingRow({
  enrollmentId,
  clubId,
  clubName,
  folder,
  finance,
  camporee,
}: {
  enrollmentId: string;
  clubId: number;
  clubName: string;
  folder: number;
  finance: number;
  camporee: number;
}) {
  return {
    club_enrollment_id: enrollmentId,
    club_type_id: CLUB_TYPE_ID,
    ecclesiastical_year_id: YEAR_ID,
    folder_score_pct: folder,
    finance_score_pct: finance,
    camporee_score_pct: camporee,
    evidence_score_pct: 0,
    composite_score_pct: 0,
    composite_calculated_at: new Date('2026-05-28T00:00:00Z'),
    hierarchy_context: { local_field_id: LOCAL_FIELD_ID },
    club_enrollment: {
      club_section: {
        clubs: {
          club_id: clubId,
          name: clubName,
        },
      },
    },
  };
}

describe('AnnualRankingsService', () => {
  let service: AnnualRankingsService;
  let prisma: any;
  let configService: jest.Mocked<AnnualRankingConfigService>;

  beforeEach(async () => {
    prisma = {
      annual_ranking_configs: {},
      ranking_tiers: {
        findMany: jest.fn().mockResolvedValue(tierRows),
      },
      club_annual_rankings: {
        findMany: jest.fn().mockResolvedValue([
          makeRankingRow({
            enrollmentId: 'enrollment-low',
            clubId: 11,
            clubName: 'Club Plata',
            folder: 70,
            finance: 50,
            camporee: 100,
          }),
          makeRankingRow({
            enrollmentId: 'enrollment-high',
            clubId: 12,
            clubName: 'Club Oro',
            folder: 100,
            finance: 100,
            camporee: 50,
          }),
        ]),
      },
    };

    configService = {
      getByScope: jest.fn().mockResolvedValue(configRow),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        AnnualRankingsService,
        RankingTierCalculatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnualRankingConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(AnnualRankingsService);
  });

  it('returns admin leaderboard rows ordered by derived annual points and tier', async () => {
    const result = await service.getLeaderboard({
      localFieldId: LOCAL_FIELD_ID,
      yearId: YEAR_ID,
      clubTypeId: CLUB_TYPE_ID,
    });

    expect(configService.getByScope).toHaveBeenCalledWith({
      localFieldId: LOCAL_FIELD_ID,
      ecclesiasticalYearId: YEAR_ID,
      clubTypeId: CLUB_TYPE_ID,
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      rank_position: 1,
      club_enrollment_id: 'enrollment-high',
      club_id: 12,
      club_name: 'Club Oro',
      current_points: 9000,
      max_points: 10000,
      current_tier: { slug: 'oro' },
    });
    expect(result.data[1]).toMatchObject({
      rank_position: 2,
      club_enrollment_id: 'enrollment-low',
      club_id: 11,
      club_name: 'Club Plata',
      current_points: 7200,
      current_tier: { slug: 'plata' },
    });
  });

  it('filters rankings by local field, year, club type and general category', async () => {
    await service.getLeaderboard({
      localFieldId: LOCAL_FIELD_ID,
      yearId: YEAR_ID,
      clubTypeId: CLUB_TYPE_ID,
    });

    expect(prisma.club_annual_rankings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          club_type_id: CLUB_TYPE_ID,
          ecclesiastical_year_id: YEAR_ID,
          award_category_id: '00000000-0000-0000-0000-000000000000',
        }),
      }),
    );
  });
});
