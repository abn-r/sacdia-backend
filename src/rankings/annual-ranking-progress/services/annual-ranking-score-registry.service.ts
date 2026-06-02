import { Injectable } from '@nestjs/common';
import { FolderScoreService } from '../../../annual-folders/score-calculators/folder-score';
import { FinanceScoreService } from '../../../annual-folders/score-calculators/finance-score';
import { CamporeeScoreService } from '../../../annual-folders/score-calculators/camporee-score';
import { MonthlyReportsTimelinessScoreService } from '../../../annual-folders/score-calculators/monthly-reports-timeliness-score';
import { InstitutionalDataCompletenessScoreService } from '../../../annual-folders/score-calculators/institutional-data-completeness-score';
import { ActivitiesRegisteredScoreService } from '../../../annual-folders/score-calculators/activities-registered-score';
import { AttendanceParticipationScoreService } from '../../../annual-folders/score-calculators/attendance-participation-score';
import { ClassInvestitureProgressScoreService } from '../../../annual-folders/score-calculators/class-investiture-progress-score';
import { SacdiaOperationalUsageScoreService } from '../../../annual-folders/score-calculators/sacdia-operational-usage-score';
import { normalizeRankingComponentKey } from '../ranking-component-catalog';

export type AnnualRankingScoreSourceStatus = 'available' | 'not_available';

export interface AnnualRankingScoreContext {
  clubEnrollmentId: string;
  clubId: number;
  localFieldId: number;
  unionId: number | null;
  ecclesiasticalYearId: number;
  calendarYear: number;
}

export interface AnnualRankingScoredComponent {
  component_key: string;
  active?: boolean;
}

export interface AnnualRankingScoreResult {
  score_pct: number;
  source_status: AnnualRankingScoreSourceStatus;
  source:
    | 'annual_folder'
    | 'monthly_reports'
    | 'finance'
    | 'institutional_data'
    | 'activities'
    | 'attendance'
    | 'camporee'
    | 'class_investiture'
    | 'sacdia_usage'
    | 'disabled'
    | 'unsupported';
}

@Injectable()
export class AnnualRankingScoreRegistryService {
  constructor(
    private readonly folderScore: FolderScoreService,
    private readonly financeScore: FinanceScoreService,
    private readonly camporeeScore: CamporeeScoreService,
    private readonly monthlyReportsScore: MonthlyReportsTimelinessScoreService,
    private readonly institutionalDataScore: InstitutionalDataCompletenessScoreService,
    private readonly activitiesScore: ActivitiesRegisteredScoreService,
    private readonly attendanceScore: AttendanceParticipationScoreService,
    private readonly classInvestitureScore: ClassInvestitureProgressScoreService,
    private readonly sacdiaUsageScore: SacdiaOperationalUsageScoreService,
  ) {}

  async scoreComponent(
    component: AnnualRankingScoredComponent,
    context: AnnualRankingScoreContext,
  ): Promise<AnnualRankingScoreResult> {
    if (component.active === false) {
      return this.notAvailable('disabled');
    }

    const componentKey = this.safeNormalize(component.component_key);
    if (!componentKey) {
      return this.notAvailable('unsupported');
    }

    if (componentKey === 'annual_evidence_folder') {
      return {
        score_pct: this.normalizeScore(
          await this.folderScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'annual_folder',
      };
    }


    if (componentKey === 'monthly_reports_timeliness') {
      return {
        score_pct: this.normalizeScore(
          await this.monthlyReportsScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'monthly_reports',
      };
    }

    if (componentKey === 'institutional_data_completeness') {
      return {
        score_pct: this.normalizeScore(
          await this.institutionalDataScore.calc(context.clubEnrollmentId),
        ),
        source_status: 'available',
        source: 'institutional_data',
      };
    }

    if (componentKey === 'finance_compliance') {
      return {
        score_pct: this.normalizeScore(
          await this.financeScore.calc(context.clubId, context.calendarYear),
        ),
        source_status: 'available',
        source: 'finance',
      };
    }


    if (componentKey === 'activities_registered') {
      return {
        score_pct: this.normalizeScore(
          await this.activitiesScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'activities',
      };
    }

    if (componentKey === 'attendance_participation') {
      return {
        score_pct: this.normalizeScore(
          await this.attendanceScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'attendance',
      };
    }

    if (componentKey === 'camporee_events') {
      return {
        score_pct: this.normalizeScore(
          await this.camporeeScore.calc(
            context.clubId,
            context.localFieldId,
            context.unionId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'camporee',
      };
    }


    if (componentKey === 'class_investiture_progress') {
      return {
        score_pct: this.normalizeScore(
          await this.classInvestitureScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'class_investiture',
      };
    }

    if (componentKey === 'sacdia_operational_usage') {
      return {
        score_pct: this.normalizeScore(
          await this.sacdiaUsageScore.calc(
            context.clubEnrollmentId,
            context.ecclesiasticalYearId,
          ),
        ),
        source_status: 'available',
        source: 'sacdia_usage',
      };
    }

    return this.notAvailable('unsupported');
  }

  private safeNormalize(componentKey: string): string | null {
    try {
      return normalizeRankingComponentKey(componentKey);
    } catch {
      return null;
    }
  }

  private normalizeScore(score: number): number {
    return Math.max(0, Math.min(100, Number(score.toFixed(2))));
  }

  private notAvailable(
    source: AnnualRankingScoreResult['source'],
  ): AnnualRankingScoreResult {
    return {
      score_pct: 0,
      source_status: 'not_available',
      source,
    };
  }
}
