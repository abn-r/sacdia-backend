import { Test } from '@nestjs/testing';
import { AnnualRankingsService } from './annual-rankings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';
import { AnnualRankingScoreRegistryService } from './services/annual-ranking-score-registry.service';

const LOCAL_FIELD_ID = 4;
const YEAR_ID = 1;
const CLUB_TYPE_ID = 1;

const configRow = {
  max_points: 10000,
  axes: [
    {
      axis_key: 'administrative',
      label: 'Cumplimiento Administrativo',
      max_points: 8000,
      components: [
        {
          component_key: 'annual_evidence_folder',
          label: 'Carpeta Anual de Evidencias',
          max_points: 6000,
        },
        {
          component_key: 'finance_compliance',
          label: 'Finanzas',
          max_points: 2000,
        },
      ],
    },
    {
      axis_key: 'operational',
      label: 'Vida Operativa del Club',
      max_points: 2000,
      components: [
        {
          component_key: 'camporee_events',
          label: 'Camporee',
          max_points: 2000,
        },
      ],
    },
  ],
  components: [
    {
      component_key: 'annual_evidence_folder',
      label: 'Carpeta Anual de Evidencias',
      max_points: 6000,
    },
    {
      component_key: 'finance_compliance',
      label: 'Finanzas',
      max_points: 2000,
    },
    { component_key: 'camporee_events', label: 'Camporee', max_points: 2000 },
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
    hierarchy_context: { local_field_id: LOCAL_FIELD_ID, union_id: 2 },
    club_enrollment: {
      club_section: {
        clubs: {
          club_id: clubId,
          name: clubName,
          local_field_id: LOCAL_FIELD_ID,
          local_fields: { union_id: 2 },
        },
      },
    },
  };
}

describe('AnnualRankingsService', () => {
  let service: AnnualRankingsService;
  let prisma: any;
  let configService: jest.Mocked<AnnualRankingConfigService>;
  let scoreRegistry: jest.Mocked<AnnualRankingScoreRegistryService>;

  beforeEach(async () => {
    prisma = {
      annual_ranking_configs: {},
      ranking_tiers: {
        findMany: jest.fn().mockResolvedValue(tierRows),
      },
      ecclesiastical_years: {
        findUnique: jest.fn().mockResolvedValue({
          start_date: new Date('2026-01-01T00:00:00Z'),
        }),
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

    scoreRegistry = {
      scoreComponent: jest.fn(async (component, context) => {
        const perEnrollment: Record<string, Record<string, number>> = {
          'enrollment-low': {
            annual_evidence_folder: 70,
            monthly_reports_timeliness: 75,
            finance_compliance: 50,
            institutional_data_completeness: 90,
            activities_registered: 66.67,
            attendance_participation: 88.5,
            camporee_events: 100,
            class_investiture_progress: 40,
            sacdia_operational_usage: 55.56,
          },
          'enrollment-high': {
            annual_evidence_folder: 100,
            monthly_reports_timeliness: 100,
            finance_compliance: 100,
            institutional_data_completeness: 100,
            activities_registered: 100,
            attendance_participation: 100,
            camporee_events: 50,
            class_investiture_progress: 100,
            sacdia_operational_usage: 100,
          },
        };

        return {
          score_pct:
            perEnrollment[context.clubEnrollmentId]?.[component.component_key] ??
            0,
          source_status: 'available',
          source: 'annual_folder',
        } as any;
      }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        AnnualRankingsService,
        RankingTierCalculatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnualRankingConfigService, useValue: configService },
        { provide: AnnualRankingScoreRegistryService, useValue: scoreRegistry },
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
      axes: [
        {
          key: 'administrative',
          earned_points: 8000,
          max_points: 8000,
          progress_percentage: 100,
        },
        {
          key: 'operational',
          earned_points: 1000,
          max_points: 2000,
          progress_percentage: 50,
        },
      ],
    });
    expect(result.data[1]).toMatchObject({
      rank_position: 2,
      club_enrollment_id: 'enrollment-low',
      club_id: 11,
      club_name: 'Club Plata',
      current_points: 7200,
      current_tier: { slug: 'plata' },
      axes: [
        {
          key: 'administrative',
          earned_points: 5200,
          max_points: 8000,
          progress_percentage: 65,
        },
        {
          key: 'operational',
          earned_points: 2000,
          max_points: 2000,
          progress_percentage: 100,
        },
      ],
    });
  });


  it('scores expanded annual ranking components through the registry', async () => {
    configService.getByScope.mockResolvedValueOnce({
      max_points: 9000,
      axes: [
        {
          axis_key: 'administrative',
          label: 'Cumplimiento Administrativo',
          max_points: 4000,
          components: [
            { component_key: 'annual_evidence_folder', label: 'Carpeta Anual de Evidencias', max_points: 1000 },
            { component_key: 'monthly_reports_timeliness', label: 'Informes mensuales', max_points: 1000 },
            { component_key: 'finance_compliance', label: 'Finanzas', max_points: 1000 },
            { component_key: 'institutional_data_completeness', label: 'Datos institucionales', max_points: 1000 },
          ],
        },
        {
          axis_key: 'operational',
          label: 'Vida Operativa del Club',
          max_points: 5000,
          components: [
            { component_key: 'activities_registered', label: 'Actividades', max_points: 1000 },
            { component_key: 'attendance_participation', label: 'Asistencia', max_points: 1000 },
            { component_key: 'camporee_events', label: 'Camporee', max_points: 1000 },
            { component_key: 'class_investiture_progress', label: 'Clases', max_points: 1000 },
            { component_key: 'sacdia_operational_usage', label: 'Uso SACDIA', max_points: 1000 },
          ],
        },
      ],
      components: [],
    } as any);

    const result = await service.getLeaderboard({
      localFieldId: LOCAL_FIELD_ID,
      yearId: YEAR_ID,
      clubTypeId: CLUB_TYPE_ID,
    });

    expect(result.data[0]).toMatchObject({
      club_enrollment_id: 'enrollment-high',
      current_points: 8500,
      axes: [
        expect.objectContaining({ key: 'administrative', earned_points: 4000 }),
        expect.objectContaining({ key: 'operational', earned_points: 4500 }),
      ],
    });
    expect(result.data[1]).toMatchObject({
      club_enrollment_id: 'enrollment-low',
      current_points: 6358,
      axes: [
        expect.objectContaining({ key: 'administrative', earned_points: 2850 }),
        expect.objectContaining({ key: 'operational', earned_points: 3508 }),
      ],
    });
    expect(scoreRegistry.scoreComponent).toHaveBeenCalledWith(
      { component_key: 'sacdia_operational_usage', active: true },
      expect.objectContaining({
        clubEnrollmentId: 'enrollment-low',
        clubId: 11,
        localFieldId: LOCAL_FIELD_ID,
        unionId: 2,
        ecclesiasticalYearId: YEAR_ID,
        calendarYear: 2026,
      }),
    );
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
