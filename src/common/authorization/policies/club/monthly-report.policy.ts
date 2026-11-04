import { isUUID } from 'class-validator';
import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import { getRequestValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import {
  buildInstanceScopeFromSection,
  type InstanceScopeValidator,
  type ResolvedInstanceScope,
} from '../scope/instance-scope';

export class MonthlyReportPolicy implements ResourcePolicy<'monthly_report'> {
  readonly type = 'monthly_report' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: InstanceScopeValidator,
  ) {}

  async resolve({
    userId,
    request,
    resolved,
    requirement,
    resource,
  }: PolicyContext): Promise<boolean> {
    return this.scopes.validateInstanceScope(
      userId,
      resolved,
      await this.resolveMonthlyReportScope(request, resource),
      this.scopes.coordinatorSectionsCheck(resolved, requirement, resource),
      request,
    );
  }

  private async resolveMonthlyReportScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const reportId = getRequestValue(request, 'param', 'reportId');

    if (reportId) {
      if (!isUUID(String(reportId), 'all')) {
        throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_ID);
      }

      const report = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: String(reportId) },
        select: {
          club_enrollment: {
            select: {
              club_section: {
                select: {
                  club_section_id: true,
                  main_club_id: true,
                  club_type_id: true,
                },
              },
            },
          },
        },
      });

      if (!report) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      return buildInstanceScopeFromSection(report.club_enrollment.club_section);
    }

    const enrollmentId = String(
      getRequestValue(request, 'param', resource.idParam ?? 'enrollmentId') ??
        '',
    );

    if (!enrollmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    if (!isUUID(enrollmentId, 'all')) {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_ID);
    }

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: {
        club_section: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.MONTHLY_REPORT_ENROLLMENT_NOT_FOUND,
      );
    }

    return buildInstanceScopeFromSection(enrollment.club_section);
  }
}
