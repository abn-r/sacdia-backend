import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import {
  CRON_JOB_DEFINITIONS,
  describeCronJob,
  findCronJob,
  toFiveFieldCron,
} from './cron-job.registry';

const SRC_ROOT = join(__dirname, '..', '..');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return listSourceFiles(full);
    }
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Every `@Cron(...)` decorated method under src/, as `file#method`. */
function scanCronInventory(): string[] {
  const found: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8');
    const decorator = /^[ \t]*@Cron\(/gm;
    for (const match of text.matchAll(decorator)) {
      const rest = text.slice(match.index);
      const method = /\)\s*\n\s*(?:public\s+)?(?:async\s+)?(\w+)\s*\(/.exec(
        rest,
      );
      found.push(
        `${relative(SRC_ROOT, file)}#${method ? method[1] : '<unparsed>'}`,
      );
    }
  }
  return found.sort();
}

describe('cron job registry', () => {
  it('lists exactly the @Cron jobs of the codebase (add a decision for every new one)', () => {
    const inventory = scanCronInventory();

    expect(inventory.length).toBeGreaterThanOrEqual(20);
    expect(CRON_JOB_DEFINITIONS.map((def) => def.source).sort()).toEqual(
      inventory,
    );
  });

  it('gives every job a unique name', () => {
    const names = CRON_JOB_DEFINITIONS.map((def) => def.jobName);

    expect(new Set(names).size).toBe(names.length);
  });

  it('points every entry at a real @Cron-decorated method of its class', () => {
    for (const def of CRON_JOB_DEFINITIONS) {
      const method = (def.target.prototype as Record<string, unknown>)[
        def.method
      ];
      expect({
        job: def.jobName,
        decorated:
          typeof method === 'function' &&
          Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method) !== undefined,
      }).toEqual({ job: def.jobName, decorated: true });
      expect(def.source.endsWith(`#${def.method}`)).toBe(true);
      expect(
        readFileSync(join(SRC_ROOT, def.source.split('#')[0]), 'utf8'),
      ).toContain(`class ${def.target.name}`);
    }
  });

  it('describes every job with a non-empty description', () => {
    for (const def of CRON_JOB_DEFINITIONS) {
      expect({
        job: def.jobName,
        ok: def.description.trim().length > 0,
      }).toEqual({ job: def.jobName, ok: true });
    }
  });

  describe('describeCronJob (schedule read from the @Cron decorator)', () => {
    it('reads the expression and time zone of a UTC job', () => {
      const def = findCronJob('ecclesiastical-year-cut')!;

      expect(describeCronJob(def)).toEqual({
        job_name: 'ecclesiastical-year-cut',
        schedule: '5 6 * * *',
        time_zone: 'UTC',
        runnable: true,
        description: def.description,
      });
    });

    it('reads a non-UTC time zone', () => {
      const info = describeCronJob(findCronJob('monthly-reports-reminders')!);

      expect(info.schedule).toBe('0 9 * * *');
      expect(info.time_zone).toBe('America/Mexico_City');
    });

    it('returns a null time zone when the decorator sets none', () => {
      const info = describeCronJob(findCronJob('cron-alert-check')!);

      expect(info.schedule).toBe('5,20,35,50 * * * *');
      expect(info.time_zone).toBeNull();
    });

    it('normalises CronExpression constants (6 fields with seconds) to 5 fields', () => {
      expect(
        describeCronJob(findCronJob('cleanup-expired-records')!).schedule,
      ).toBe('0 0-23/6 * * *');
      expect(describeCronJob(findCronJob('fcm-tokens-cleanup')!).schedule).toBe(
        '0 3 * * *',
      );
    });
  });

  describe('toFiveFieldCron', () => {
    it('drops a leading zero seconds field and zero-padding', () => {
      expect(toFiveFieldCron('0 0 03 * * *')).toBe('0 3 * * *');
      expect(toFiveFieldCron('0 0 */6 * * *')).toBe('0 */6 * * *');
    });

    it('keeps a 5-field expression as is', () => {
      expect(toFiveFieldCron('0 1 1 1,4,7,10 *')).toBe('0 1 1 1,4,7,10 *');
    });
  });

  describe('findCronJob', () => {
    it('finds an allowlisted job and rejects anything else', () => {
      expect(findCronJob('activities-reminder')?.jobName).toBe(
        'activities-reminder',
      );
      expect(findCronJob('not-a-job')).toBeUndefined();
      expect(findCronJob('constructor')).toBeUndefined();
      expect(findCronJob('__proto__')).toBeUndefined();
    });
  });
});
