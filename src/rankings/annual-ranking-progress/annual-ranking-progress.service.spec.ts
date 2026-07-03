import { Test } from '@nestjs/testing';
import { AnnualRankingProgressService } from './annual-ranking-progress.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';
import { AnnualRankingScoreRegistryService } from './services/annual-ranking-score-registry.service';
import { AppForbiddenException } from '../../common/errors/app.exception';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

const SECTION_ID = 2;
const YEAR_ID = 1;
const CLUB_ID = 7;
const LOCAL_FIELD_ID = 4;
const CLUB_TYPE_ID = 1;

const sectionRow = {
  club_section_id: SECTION_ID,
  name: 'Aventureros Halcones',
  club_type_id: CLUB_TYPE_ID,
  club_types: { club_type_id: CLUB_TYPE_ID, name: 'Aventureros' },
  clubs: {
    club_id: CLUB_ID,
    name: 'Halcones',
    local_field_id: LOCAL_FIELD_ID,
    local_fields: { union_id: 2 },
  },
};

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

const rankingRow = {
  folder_score_pct: 70,
  finance_score_pct: 50,
  camporee_score_pct: 100,
  evidence_score_pct: 0,
};

function makeProfile(options?: {
  clubId?: number;
  sectionId?: number;
  localFieldId?: number;
  permissions?: string[];
  globalLocalFieldId?: number;
}): ResolvedAuthorizationProfile {
  const clubId = options?.clubId ?? CLUB_ID;
  const sectionId = options?.sectionId ?? SECTION_ID;
  const localFieldId = options?.localFieldId ?? LOCAL_FIELD_ID;
  const permissions = options?.permissions ?? ['rankings:read'];

  return {
    profile: {
      user_id: 'user-1',
      email: 'user@example.com',
      name: null,
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date(),
    },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: 'director',
            permissions,
            club: { club_id: clubId, club_name: 'Halcones' },
            section: { club_section_id: sectionId, club_type_name: null },
            scope: {
              local_field: { id: localFieldId, name: 'Centro Veracruz' },
            },
            status: 'active',
            start_date: null,
            end_date: null,
            expires_at: null,
          },
        ],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions,
        scope: {
          global: {},
          club: {
            assignment_id: 'assignment-1',
            role_name: 'director',
            club: { club_id: clubId, club_name: 'Halcones' },
            section: { club_section_id: sectionId, club_type_name: null },
          },
        },
      },
    },
    legacy: {
      roles: [],
      permissions,
      club: null,
      club_context: { active_assignment_id: null, active: null, available: [] },
    },
  };
}

function makeLocalFieldProfile(): ResolvedAuthorizationProfile {
  const profile = makeProfile({
    clubId: 999,
    sectionId: 999,
    localFieldId: LOCAL_FIELD_ID,
    permissions: ['rankings:read_lf'],
  });

  profile.authorization.effective.scope.global = {
    local_field: { id: LOCAL_FIELD_ID, name: 'Centro Veracruz' },
  };

  return profile;
}

describe('AnnualRankingProgressService', () => {
  let service: AnnualRankingProgressService;
  let prisma: any;
  let configService: jest.Mocked<AnnualRankingConfigService>;
  let tierCalculator: jest.Mocked<RankingTierCalculatorService>;
  let scoreRegistry: jest.Mocked<AnnualRankingScoreRegistryService>;

  beforeEach(async () => {
    prisma = {
      club_sections: { findUnique: jest.fn().mockResolvedValue(sectionRow) },
      club_enrollments: {
        findFirst: jest.fn().mockResolvedValue({
          club_enrollment_id: 'enrollment-1',
        }),
      },
      club_annual_rankings: {
        findFirst: jest.fn().mockResolvedValue(rankingRow),
      },
      ecclesiastical_years: {
        findUnique: jest.fn().mockResolvedValue({
          start_date: new Date('2026-01-01T00:00:00Z'),
        }),
      },
      ranking_tiers: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Diamante',
            slug: 'diamante',
            band_percentage: 5,
            sort_order: 1,
          },
          { name: 'Oro', slug: 'oro', band_percentage: 10, sort_order: 2 },
        ]),
      },
      annual_folders: {
        findUnique: jest.fn().mockResolvedValue({
          evaluations: [
            {
              status: 'SUBMITTED',
              section: { name: 'Actividades misioneras' },
            },
          ],
        }),
      },
    };

    configService = {
      getByScope: jest.fn().mockResolvedValue(configRow),
    } as any;

    scoreRegistry = {
      scoreComponent: jest.fn(async (component) => {
        const scores: Record<string, number> = {
          annual_evidence_folder: 70,
          monthly_reports_timeliness: 75,
          finance_compliance: 50,
          institutional_data_completeness: 90,
          activities_registered: 66.67,
          attendance_participation: 88.5,
          camporee_events: 100,
          class_investiture_progress: 40,
          sacdia_operational_usage: 55.56,
        };

        return {
          score_pct: scores[component.component_key] ?? 0,
          source_status: 'available',
          source: 'annual_folder',
        } as any;
      }),
    } as any;

    tierCalculator = {
      resolveTier: jest.fn().mockReturnValue({
        currentTier: {
          name: 'Plata',
          slug: 'plata',
          fromPoints: 7000,
          toPoints: 8499,
        },
        nextTier: {
          name: 'Oro',
          slug: 'oro',
          fromPoints: 8500,
          toPoints: 9499,
        },
        pointsToNextTier: 1300,
        ranges: [],
      }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        AnnualRankingProgressService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnualRankingConfigService, useValue: configService },
        { provide: RankingTierCalculatorService, useValue: tierCalculator },
        { provide: AnnualRankingScoreRegistryService, useValue: scoreRegistry },
      ],
    }).compile();

    service = module.get(AnnualRankingProgressService);
  });

  it('returns section-scoped annual progress with component points', async () => {
    const result = await service.getSectionProgress(
      SECTION_ID,
      YEAR_ID,
      makeProfile(),
    );

    expect(result.current_points).toBe(7200);
    expect(result.max_points).toBe(10000);
    expect(result.progress_percentage).toBe(72);
    expect(result.components).toEqual([
      {
        key: 'annual_evidence_folder',
        label: 'Carpeta Anual de Evidencias',
        earned_points: 4200,
        max_points: 6000,
        progress_percentage: 70,
      },
      {
        key: 'finance_compliance',
        label: 'Finanzas',
        earned_points: 1000,
        max_points: 2000,
        progress_percentage: 50,
      },
      {
        key: 'camporee_events',
        label: 'Camporee',
        earned_points: 2000,
        max_points: 2000,
        progress_percentage: 100,
      },
    ]);
    expect(result.axes).toEqual([
      {
        key: 'administrative',
        label: 'Cumplimiento Administrativo',
        earned_points: 5200,
        max_points: 8000,
        progress_percentage: 65,
        components: [
          {
            key: 'annual_evidence_folder',
            label: 'Carpeta Anual de Evidencias',
            earned_points: 4200,
            max_points: 6000,
            progress_percentage: 70,
          },
          {
            key: 'finance_compliance',
            label: 'Finanzas',
            earned_points: 1000,
            max_points: 2000,
            progress_percentage: 50,
          },
        ],
      },
      {
        key: 'operational',
        label: 'Vida Operativa del Club',
        earned_points: 2000,
        max_points: 2000,
        progress_percentage: 100,
        components: [
          {
            key: 'camporee_events',
            label: 'Camporee',
            earned_points: 2000,
            max_points: 2000,
            progress_percentage: 100,
          },
        ],
      },
    ]);
    expect(result.next_tier?.points_to_reach).toBe(1300);
    expect(result.pending_items).toEqual([
      {
        type: 'annual_folder_section',
        title: 'Actividades misioneras',
        status: 'pending_validation',
        due_date: null,
        action_label: 'Ver evidencia',
      },
    ]);
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
            {
              component_key: 'annual_evidence_folder',
              label: 'Carpeta Anual de Evidencias',
              max_points: 1000,
            },
            {
              component_key: 'monthly_reports_timeliness',
              label: 'Informes mensuales',
              max_points: 1000,
            },
            {
              component_key: 'finance_compliance',
              label: 'Finanzas',
              max_points: 1000,
            },
            {
              component_key: 'institutional_data_completeness',
              label: 'Datos institucionales',
              max_points: 1000,
            },
          ],
        },
        {
          axis_key: 'operational',
          label: 'Vida Operativa del Club',
          max_points: 5000,
          components: [
            {
              component_key: 'activities_registered',
              label: 'Actividades',
              max_points: 1000,
            },
            {
              component_key: 'attendance_participation',
              label: 'Asistencia',
              max_points: 1000,
            },
            {
              component_key: 'camporee_events',
              label: 'Camporee',
              max_points: 1000,
            },
            {
              component_key: 'class_investiture_progress',
              label: 'Clases',
              max_points: 1000,
            },
            {
              component_key: 'sacdia_operational_usage',
              label: 'Uso SACDIA',
              max_points: 1000,
            },
          ],
        },
      ],
      components: [],
    } as any);

    const result = await service.getSectionProgress(
      SECTION_ID,
      YEAR_ID,
      makeProfile(),
    );

    expect(result.current_points).toBe(6358);
    expect(result.axes[0].earned_points).toBe(2850);
    expect(result.axes[1].earned_points).toBe(3508);
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'monthly_reports_timeliness',
          earned_points: 750,
        }),
        expect.objectContaining({
          key: 'activities_registered',
          earned_points: 667,
        }),
        expect.objectContaining({
          key: 'sacdia_operational_usage',
          earned_points: 556,
        }),
      ]),
    );
    expect(scoreRegistry.scoreComponent).toHaveBeenCalledWith(
      { component_key: 'monthly_reports_timeliness', active: true },
      expect.objectContaining({
        clubEnrollmentId: 'enrollment-1',
        clubId: CLUB_ID,
        clubSectionId: SECTION_ID,
        localFieldId: LOCAL_FIELD_ID,
        unionId: 2,
        ecclesiasticalYearId: YEAR_ID,
        calendarYear: 2026,
      }),
    );
  });

  it('returns canonical component keys when config rows still contain legacy aliases', async () => {
    configService.getByScope.mockResolvedValueOnce({
      max_points: 6000,
      axes: [
        {
          axis_key: 'administrative',
          label: 'Cumplimiento Administrativo',
          max_points: 6000,
          components: [
            {
              component_key: 'annual_folder',
              label: 'Carpeta Anual de Evidencias',
              max_points: 6000,
            },
          ],
        },
      ],
      components: [],
    } as any);
    scoreRegistry.scoreComponent.mockResolvedValueOnce({
      score_pct: 70,
      earned_points: 4200,
      max_points: 6000,
      source_status: 'available',
      source: 'annual_folder',
    });

    const result = await service.getSectionProgress(
      SECTION_ID,
      YEAR_ID,
      makeProfile(),
    );

    expect(result.components).toEqual([
      expect.objectContaining({
        key: 'annual_evidence_folder',
        earned_points: 4200,
        max_points: 6000,
      }),
    ]);
  });

  it('resolves annual config from section local field, year, and club type', async () => {
    await service.getSectionProgress(SECTION_ID, YEAR_ID, makeProfile());

    expect(configService.getByScope).toHaveBeenCalledWith({
      localFieldId: LOCAL_FIELD_ID,
      ecclesiasticalYearId: YEAR_ID,
      clubTypeId: CLUB_TYPE_ID,
    });
  });

  it('rejects a profile with no access to the section club', async () => {
    await expect(
      service.getSectionProgress(
        SECTION_ID,
        YEAR_ID,
        makeProfile({
          clubId: 999,
          sectionId: 999,
          localFieldId: 999,
        }),
      ),
    ).rejects.toBeInstanceOf(AppForbiddenException);
  });

  it('allows a local-field scoped profile to read section progress in its field', async () => {
    await expect(
      service.getSectionProgress(SECTION_ID, YEAR_ID, makeLocalFieldProfile()),
    ).resolves.toMatchObject({
      section_id: SECTION_ID,
      club_id: CLUB_ID,
    });
  });
});
