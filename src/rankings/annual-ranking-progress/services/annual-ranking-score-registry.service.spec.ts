import { Test } from '@nestjs/testing';
import {
  AnnualRankingScoreRegistryService,
  type AnnualRankingScoreContext,
} from './annual-ranking-score-registry.service';
import { FolderScoreService } from '../../../annual-folders/score-calculators/folder-score';
import { FinanceScoreService } from '../../../annual-folders/score-calculators/finance-score';
import { CamporeeScoreService } from '../../../annual-folders/score-calculators/camporee-score';
import { MonthlyReportsTimelinessScoreService } from '../../../annual-folders/score-calculators/monthly-reports-timeliness-score';
import { InstitutionalDataCompletenessScoreService } from '../../../annual-folders/score-calculators/institutional-data-completeness-score';
import { ActivitiesRegisteredScoreService } from '../../../annual-folders/score-calculators/activities-registered-score';
import { AttendanceParticipationScoreService } from '../../../annual-folders/score-calculators/attendance-participation-score';
import { ClassInvestitureProgressScoreService } from '../../../annual-folders/score-calculators/class-investiture-progress-score';
import { SacdiaOperationalUsageScoreService } from '../../../annual-folders/score-calculators/sacdia-operational-usage-score';

describe('AnnualRankingScoreRegistryService', () => {
  let service: AnnualRankingScoreRegistryService;
  let folderScore: jest.Mocked<FolderScoreService>;
  let financeScore: jest.Mocked<FinanceScoreService>;
  let camporeeScore: jest.Mocked<CamporeeScoreService>;
  let monthlyReportsScore: jest.Mocked<MonthlyReportsTimelinessScoreService>;
  let institutionalDataScore: jest.Mocked<InstitutionalDataCompletenessScoreService>;
  let activitiesScore: jest.Mocked<ActivitiesRegisteredScoreService>;
  let attendanceScore: jest.Mocked<AttendanceParticipationScoreService>;
  let classInvestitureScore: jest.Mocked<ClassInvestitureProgressScoreService>;
  let sacdiaUsageScore: jest.Mocked<SacdiaOperationalUsageScoreService>;

  const context: AnnualRankingScoreContext = {
    clubEnrollmentId: '11111111-1111-4111-8111-111111111111',
    clubId: 42,
    localFieldId: 4,
    unionId: 2,
    ecclesiasticalYearId: 1,
    calendarYear: 2026,
  };

  beforeEach(async () => {
    folderScore = { calc: jest.fn().mockResolvedValue(83.33) } as any;
    financeScore = { calc: jest.fn().mockResolvedValue(91.66) } as any;
    camporeeScore = { calc: jest.fn().mockResolvedValue(50) } as any;
    monthlyReportsScore = { calc: jest.fn().mockResolvedValue(75) } as any;
    institutionalDataScore = { calc: jest.fn().mockResolvedValue(90) } as any;
    activitiesScore = { calc: jest.fn().mockResolvedValue(66.67) } as any;
    attendanceScore = { calc: jest.fn().mockResolvedValue(88.5) } as any;
    classInvestitureScore = { calc: jest.fn().mockResolvedValue(40) } as any;
    sacdiaUsageScore = { calc: jest.fn().mockResolvedValue(55.56) } as any;

    const module = await Test.createTestingModule({
      providers: [
        AnnualRankingScoreRegistryService,
        { provide: FolderScoreService, useValue: folderScore },
        { provide: FinanceScoreService, useValue: financeScore },
        { provide: CamporeeScoreService, useValue: camporeeScore },
        {
          provide: MonthlyReportsTimelinessScoreService,
          useValue: monthlyReportsScore,
        },
        {
          provide: InstitutionalDataCompletenessScoreService,
          useValue: institutionalDataScore,
        },
        { provide: ActivitiesRegisteredScoreService, useValue: activitiesScore },
        {
          provide: AttendanceParticipationScoreService,
          useValue: attendanceScore,
        },
        {
          provide: ClassInvestitureProgressScoreService,
          useValue: classInvestitureScore,
        },
        {
          provide: SacdiaOperationalUsageScoreService,
          useValue: sacdiaUsageScore,
        },
      ],
    }).compile();

    service = module.get(AnnualRankingScoreRegistryService);
  });

  it('uses annual evidence folder percentage for annual_evidence_folder', async () => {
    const result = await service.scoreComponent(
      { component_key: 'annual_evidence_folder', active: true },
      context,
    );

    expect(result).toEqual({
      score_pct: 83.33,
      source_status: 'available',
      source: 'annual_folder',
    });
    expect(folderScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves legacy annual_folder to the same annual evidence folder calculator', async () => {
    await expect(
      service.scoreComponent({ component_key: 'annual_folder' }, context),
    ).resolves.toMatchObject({
      score_pct: 83.33,
      source_status: 'available',
      source: 'annual_folder',
    });
  });

  it('resolves monthly_reports_timeliness to monthly report timeliness score', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'monthly_reports_timeliness' },
        context,
      ),
    ).resolves.toMatchObject({
      score_pct: 75,
      source_status: 'available',
      source: 'monthly_reports',
    });
    expect(monthlyReportsScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves institutional_data_completeness to institutional data score', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'institutional_data_completeness' },
        context,
      ),
    ).resolves.toMatchObject({
      score_pct: 90,
      source_status: 'available',
      source: 'institutional_data',
    });
    expect(institutionalDataScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
    );
  });

  it('resolves finance_compliance to finance score', async () => {
    await expect(
      service.scoreComponent({ component_key: 'finance_compliance' }, context),
    ).resolves.toMatchObject({
      score_pct: 91.66,
      source_status: 'available',
      source: 'finance',
    });
    expect(financeScore.calc).toHaveBeenCalledWith(
      context.clubId,
      context.calendarYear,
    );
  });

  it('resolves activities_registered to activities score', async () => {
    await expect(
      service.scoreComponent({ component_key: 'activities_registered' }, context),
    ).resolves.toMatchObject({
      score_pct: 66.67,
      source_status: 'available',
      source: 'activities',
    });
    expect(activitiesScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves attendance_participation to attendance score', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'attendance_participation' },
        context,
      ),
    ).resolves.toMatchObject({
      score_pct: 88.5,
      source_status: 'available',
      source: 'attendance',
    });
    expect(attendanceScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves camporee_events to camporee score', async () => {
    await expect(
      service.scoreComponent({ component_key: 'camporee_events' }, context),
    ).resolves.toMatchObject({
      score_pct: 50,
      source_status: 'available',
      source: 'camporee',
    });
    expect(camporeeScore.calc).toHaveBeenCalledWith(
      context.clubId,
      context.localFieldId,
      context.unionId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves class_investiture_progress to class investiture score', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'class_investiture_progress' },
        context,
      ),
    ).resolves.toMatchObject({
      score_pct: 40,
      source_status: 'available',
      source: 'class_investiture',
    });
    expect(classInvestitureScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('resolves sacdia_operational_usage to useful operational usage score', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'sacdia_operational_usage' },
        context,
      ),
    ).resolves.toMatchObject({
      score_pct: 55.56,
      source_status: 'available',
      source: 'sacdia_usage',
    });
    expect(sacdiaUsageScore.calc).toHaveBeenCalledWith(
      context.clubEnrollmentId,
      context.ecclesiasticalYearId,
    );
  });

  it('returns explicit not_available for disabled or unsupported components', async () => {
    await expect(
      service.scoreComponent(
        { component_key: 'monthly_reports_timeliness', active: false },
        context,
      ),
    ).resolves.toEqual({
      score_pct: 0,
      source_status: 'not_available',
      source: 'disabled',
    });

    await expect(
      service.scoreComponent(
        { component_key: 'unknown_component', active: true },
        context,
      ),
    ).resolves.toEqual({
      score_pct: 0,
      source_status: 'not_available',
      source: 'unsupported',
    });
  });
});
