import type { Type } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ActivitiesReminderService } from '../../activities/activities-reminder.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { AnnualReportsCronService } from '../../annual-reports/annual-reports-cron.service';
import { CleanupService } from '../../common/services/cleanup.service';
import { CronAlertService } from '../../common/services/cron-alert.service';
import { DataExportService } from '../../data-export/data-export.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { DependentProfilesPurgeCronService } from '../../guardianships/dependent-profiles-purge-cron.service';
import { FamilyAgeTransitionsCronService } from '../../guardianships/family-age-transitions-cron.service';
import { PendingTeenCronService } from '../../guardianships/pending-teen-cron.service';
import { InvestitureAchievementIntentReconciler } from '../../investiture-requests/investiture-achievement-intent.reconciler';
import { InvestitureReminderCron } from '../../investiture-requests/investiture-reminder.cron';
import { MemberOfMonthCronService } from '../../member-of-month/member-of-month-cron.service';
import { MembershipRequestsCronService } from '../../membership-requests/membership-requests-cron.service';
import { MonthlyReportsCronService } from '../../monthly-reports/monthly-reports-cron.service';
import { MonthlyReportsReminderCronService } from '../../monthly-reports/monthly-reports-reminder-cron.service';
import { FcmTokensService } from '../../notifications/fcm-tokens.service';
import { QuarterlyReportsCronService } from '../../quarterly-reports/quarterly-reports-cron.service';
import { YearCutCronService } from '../../year-cut/year-cut-cron.service';

/**
 * Allowlist of the scheduled jobs a super-admin may run on demand.
 *
 * Every `@Cron` method of the codebase is listed explicitly: there is no
 * dynamic invocation by arbitrary name. `cron-job.registry.spec.ts` scans the
 * sources and fails when a `@Cron` appears (or disappears) without a matching
 * entry here, so adding a job is always a reviewed decision.
 *
 * The schedule is NOT repeated here: it is read from the `@Cron` metadata of
 * the method, so it can never drift from what the scheduler really runs.
 */
export interface CronJobDefinition {
  /**
   * Name the job writes in `cron_run_log.job_name` (what the admin jobs page
   * groups by). Jobs that do not log a run use the name of their `@Cron`.
   */
  jobName: string;
  /** Provider that owns the `@Cron` method (resolved from the live app). */
  target: Type<unknown>;
  /** The `@Cron` method: the very entry point the scheduler invokes. */
  method: string;
  /** `path/under/src.ts#method`, matched against the scanned inventory. */
  source: string;
  /** Short, human description (Spanish: shown in the admin panel). */
  description: string;
  /**
   * The handler hands the work to a BullMQ worker when Redis is available, so
   * the run row is written later by the worker (not awaited by the request).
   */
  queueBacked?: boolean;
}

export const CRON_JOB_DEFINITIONS: readonly CronJobDefinition[] = [
  {
    jobName: 'activities-reminder',
    target: ActivitiesReminderService,
    method: 'handleActivityReminders',
    source: 'activities/activities-reminder.service.ts#handleActivityReminders',
    description:
      'Envía el recordatorio push de las actividades próximas a comenzar.',
  },
  {
    jobName: 'rankings-recalculate',
    target: RankingsService,
    method: 'handleRankingsRecalculation',
    source: 'annual-folders/rankings.service.ts#handleRankingsRecalculation',
    description: 'Recalcula los rankings anuales de clubes.',
    queueBacked: true,
  },
  {
    jobName: 'annual-reports-auto-generate',
    target: AnnualReportsCronService,
    method: 'handleAutoGenerate',
    source: 'annual-reports/annual-reports-cron.service.ts#handleAutoGenerate',
    description:
      'Genera los informes anuales del año eclesiástico recién terminado (requiere el flag de configuración).',
  },
  {
    jobName: 'cleanup-expired-records',
    target: CleanupService,
    method: 'cleanupExpiredRecords',
    source: 'common/services/cleanup.service.ts#cleanupExpiredRecords',
    description: 'Elimina sesiones y tokens de verificación ya expirados.',
  },
  {
    jobName: 'fcm-tokens-cleanup',
    target: CleanupService,
    method: 'cleanupInactiveFcmTokens',
    source: 'common/services/cleanup.service.ts#cleanupInactiveFcmTokens',
    description: 'Elimina los tokens FCM inactivos desde hace más de 90 días.',
  },
  {
    jobName: 'cron-alert-check',
    target: CronAlertService,
    method: 'checkAndAlertFailures',
    source: 'common/services/cron-alert.service.ts#checkAndAlertFailures',
    description:
      'Revisa las ejecuciones de los demás jobs y alerta a los super-admin si alguno falla o deja de correr.',
  },
  {
    jobName: 'data-export-cleanup',
    target: DataExportService,
    method: 'cleanupExpiredExports',
    source: 'data-export/data-export.service.ts#cleanupExpiredExports',
    description:
      'Marca como expiradas las exportaciones de datos vencidas y borra sus archivos.',
  },
  {
    jobName: 'finance-period-closing',
    target: FinancePeriodService,
    method: 'handleMonthlyClosing',
    source: 'finances/finance-period.service.ts#handleMonthlyClosing',
    description: 'Cierra el periodo financiero del mes anterior en cada club.',
    queueBacked: true,
  },
  {
    jobName: 'dependent-profiles-purge',
    target: DependentProfilesPurgeCronService,
    method: 'handlePurge',
    source:
      'guardianships/dependent-profiles-purge-cron.service.ts#handlePurge',
    description:
      'Purga los perfiles de dependientes congelados cuyo plazo de purga ya venció.',
  },
  {
    jobName: 'family-age-transitions',
    target: FamilyAgeTransitionsCronService,
    method: 'handleDaily',
    source: 'guardianships/family-age-transitions-cron.service.ts#handleDaily',
    description:
      'Avisa del cumpleaños 13 y revoca dispositivos vinculados al llegar a la mayoría de edad o al vencer.',
  },
  {
    jobName: 'pending-teen-guardian',
    target: PendingTeenCronService,
    method: 'handleDaily',
    source: 'guardianships/pending-teen-cron.service.ts#handleDaily',
    description:
      'Inicia el reloj de tutor de adolescentes pendientes, envía recordatorios y congela los vencidos.',
  },
  {
    jobName: 'investiture-achievement-intent',
    target: InvestitureAchievementIntentReconciler,
    method: 'reconcile',
    source:
      'investiture-requests/investiture-achievement-intent.reconciler.ts#reconcile',
    description:
      'Entrega las intenciones de logro de investidura ya confirmadas que quedaron pendientes.',
  },
  {
    jobName: 'investiture-authorization-reminders',
    target: InvestitureReminderCron,
    method: 'handle',
    source: 'investiture-requests/investiture-reminder.cron.ts#handle',
    description:
      'Despacha los recordatorios de autorización de investidura y reintenta los envíos pendientes.',
  },
  {
    jobName: 'member-of-month-auto-evaluate',
    target: MemberOfMonthCronService,
    method: 'handleAutoEvaluate',
    source:
      'member-of-month/member-of-month-cron.service.ts#handleAutoEvaluate',
    description:
      'Evalúa el miembro del mes anterior en todas las secciones activas.',
  },
  {
    jobName: 'membership-requests-expiry',
    target: MembershipRequestsCronService,
    method: 'handleExpiry',
    source:
      'membership-requests/membership-requests-cron.service.ts#handleExpiry',
    description:
      'Expira las solicitudes de membresía pendientes que se vencieron.',
  },
  {
    jobName: 'monthly-reports-auto-generate',
    target: MonthlyReportsCronService,
    method: 'handleAutoGenerate',
    source:
      'monthly-reports/monthly-reports-cron.service.ts#handleAutoGenerate',
    description:
      'Concilia y genera los informes mensuales de los periodos vencidos.',
    queueBacked: true,
  },
  {
    jobName: 'monthly-reports-reminders',
    target: MonthlyReportsReminderCronService,
    method: 'handleReminderNotifications',
    source:
      'monthly-reports/monthly-reports-reminder-cron.service.ts#handleReminderNotifications',
    description:
      'Envía los recordatorios del cierre de informes mensuales (solo en los días del ciclo).',
  },
  {
    jobName: 'fcm-tokens-stale-cleanup',
    target: FcmTokensService,
    method: 'cleanupOldTokens',
    source: 'notifications/fcm-tokens.service.ts#cleanupOldTokens',
    description:
      'Elimina los tokens FCM sin uso en 90 días (no registra ejecución en cron_run_log).',
  },
  {
    jobName: 'quarterly-reports-auto-generate',
    target: QuarterlyReportsCronService,
    method: 'handleAutoGenerate',
    source:
      'quarterly-reports/quarterly-reports-cron.service.ts#handleAutoGenerate',
    description:
      'Genera los informes trimestrales del trimestre recién terminado (requiere el flag de configuración).',
  },
  {
    jobName: 'ecclesiastical-year-cut',
    target: YearCutCronService,
    method: 'handleYearCut',
    source: 'year-cut/year-cut-cron.service.ts#handleYearCut',
    description:
      'Corte del año eclesiástico: termina cargos vencidos y activa los planes de directiva programados.',
  },
];

export interface CronJobListItem {
  job_name: string;
  schedule: string;
  time_zone: string | null;
  runnable: boolean;
  description: string;
}

interface CronDecoratorOptions {
  cronTime: unknown;
  timeZone?: string;
}

export function findCronJob(jobName: string): CronJobDefinition | undefined {
  return CRON_JOB_DEFINITIONS.find((def) => def.jobName === jobName);
}

/**
 * `CronExpression.*` constants are not in one canonical shape: some carry a
 * leading seconds field ("0 0 0-23/6 * * *") and some zero-pad numbers
 * ("0 03 * * *"). The admin panel shows the standard 5-field form, so a
 * zero-seconds 6-field expression is reduced to it and the padding dropped.
 */
export function toFiveFieldCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  const standard =
    fields.length === 6 && fields[0] === '0' ? fields.slice(1) : fields;
  return standard
    .map((field) => (/^0\d+$/.test(field) ? String(Number(field)) : field))
    .join(' ');
}

export function describeCronJob(def: CronJobDefinition): CronJobListItem {
  const method = (def.target.prototype as Record<string, unknown>)[def.method];
  const options = Reflect.getMetadata(
    SCHEDULE_CRON_OPTIONS,
    method as object,
  ) as CronDecoratorOptions | undefined;

  return {
    job_name: def.jobName,
    schedule: toFiveFieldCron(String(options?.cronTime ?? '')),
    time_zone: options?.timeZone ?? null,
    runnable: true,
    description: def.description,
  };
}
