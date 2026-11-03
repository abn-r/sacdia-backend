/**
 * Metadata keys that `@Cron()` from `@nestjs/schedule` writes on a method.
 * Since v12 the package only exports its root entry, so the constants file
 * (`dist/schedule.constants`) can no longer be imported. The values are the
 * plain strings the decorator uses.
 */
export const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
export const SCHEDULER_NAME = 'SCHEDULER_NAME';
