import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_ACTIVITY_TARGET = 12;
const SYSTEM_CONFIG_KEY = 'ranking.activities_registered_target';

@Injectable()
export class ActivitiesRegisteredScoreService {
  private readonly logger = new Logger(ActivitiesRegisteredScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calc(
    clubEnrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const target = await this.resolveActivityTarget();

    const rows = await this.prisma.$queryRaw<{ registered: bigint }[]>`
      WITH enrollment_scope AS (
        SELECT ce.club_section_id
        FROM club_enrollments ce
        WHERE ce.club_enrollment_id = ${clubEnrollmentId}::uuid
          AND ce.ecclesiastical_year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      year_scope AS (
        SELECT start_date, end_date
        FROM ecclesiastical_years
        WHERE year_id = ${ecclesiasticalYearId}
        LIMIT 1
      )
      SELECT COUNT(DISTINCT ai.activity_instance_id)::bigint AS registered
      FROM enrollment_scope es
      JOIN activity_instances ai
        ON ai.club_section_id = es.club_section_id
       AND ai.active = true
      JOIN activities a
        ON a.activity_id = ai.activity_id
       AND a.active = true
      JOIN year_scope ys ON TRUE
      WHERE a.activity_date IS NOT NULL
        AND a.activity_date <= ys.end_date
        AND COALESCE(a.activity_end_date, a.activity_date) >= ys.start_date
    `;

    const registered = Number(rows[0]?.registered ?? 0n);
    return this.normalizePercentage((registered / target) * 100);
  }

  private async resolveActivityTarget(): Promise<number> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: SYSTEM_CONFIG_KEY },
    });
    if (!row) {
      this.logger.warn(
        `system_config[${SYSTEM_CONFIG_KEY}] missing, using default ${DEFAULT_ACTIVITY_TARGET}`,
      );
      return DEFAULT_ACTIVITY_TARGET;
    }

    const parsed = parseInt(row.config_value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      this.logger.warn(
        `system_config[${SYSTEM_CONFIG_KEY}] invalid ("${row.config_value}"), using default ${DEFAULT_ACTIVITY_TARGET}`,
      );
      return DEFAULT_ACTIVITY_TARGET;
    }

    return parsed;
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
