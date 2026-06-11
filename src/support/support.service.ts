import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportReportDto } from './dto/create-support-report.dto';
import { SupportReportResponseDto } from './dto/support-report-response.dto';
import * as Sentry from '@sentry/node';
import {
  QuerySupportReportsDto,
  SupportReportStatus,
} from './dto/query-support-reports.dto';
import {
  AdminSupportReportDto,
  AdminSupportReportsPageDto,
} from './dto/admin-support-report.dto';

type SupportReportWithUser = Prisma.support_reportsGetPayload<{
  include: {
    user: {
      select: {
        user_id: true;
        email: true;
        name: true;
        paternal_last_name: true;
        maternal_last_name: true;
        user_image: true;
      };
    };
  };
}>;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un nuevo reporte de soporte.
   *
   * El rate-limit (5/h/usuario) se aplica a nivel controller vía
   * `@Throttle` — aquí solo persistimos.
   *
   * Sentry breadcrumb opcional: registra el evento en el contexto del usuario
   * actual para facilitar triage cuando el reporte referencia un crash reciente.
   */
  async createReport(
    userId: string,
    dto: CreateSupportReportDto,
  ): Promise<SupportReportResponseDto> {
    const created = await this.prisma.support_reports.create({
      data: {
        user_id: userId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        // Prisma 7 tightened InputJsonValue — Record<string, unknown> is not
        // directly assignable because TS can't verify values are JSON-safe
        // (could contain Symbols/functions). Cast at service layer following
        // the same pattern used across the codebase (clubs, activities, honors).
        device_info: dto.deviceInfo as Prisma.InputJsonValue,
        user_context:
          dto.userContext !== undefined
            ? (dto.userContext as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    this.logger.log(
      `Support report ${created.id} created by user ${userId} (${dto.category})`,
    );

    try {
      Sentry.addBreadcrumb({
        category: 'support',
        message: `Report submitted (${dto.category})`,
        level: 'info',
        data: {
          reportId: created.id,
          userId,
          title: dto.title,
        },
      });
    } catch (e) {
      // Sentry nunca debe romper el flujo — si el SDK no está inicializado
      // en este entorno, simplemente lo ignoramos.
      this.logger.debug(
        `Sentry breadcrumb failed (non-fatal): ${(e as Error).message}`,
      );
    }

    return {
      reportId: created.id,
      createdAt: created.created_at.toISOString(),
    };
  }

  async listReports(
    query: QuerySupportReportsDto,
  ): Promise<AdminSupportReportsPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildReportWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.support_reports.findMany({
        where,
        include: this.adminReportInclude(),
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.support_reports.count({ where }),
    ]);

    return {
      total,
      page,
      limit,
      items: items.map((item) => this.toAdminReport(item)),
    };
  }

  async getReport(reportId: string): Promise<AdminSupportReportDto> {
    const report = await this.prisma.support_reports.findUniqueOrThrow({
      where: { id: reportId },
      include: this.adminReportInclude(),
    });

    return this.toAdminReport(report);
  }

  async updateReportStatus(
    reportId: string,
    status: SupportReportStatus,
  ): Promise<AdminSupportReportDto> {
    const updated = await this.prisma.support_reports.update({
      where: { id: reportId },
      data: { status },
      include: this.adminReportInclude(),
    });

    this.logger.log(`Support report ${reportId} status updated to ${status}`);

    return this.toAdminReport(updated);
  }

  private buildReportWhere(
    query: QuerySupportReportsDto,
  ): Prisma.support_reportsWhereInput {
    const where: Prisma.support_reportsWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.userId) {
      where.user_id = query.userId;
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        {
          user: {
            paternal_last_name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          user: {
            maternal_last_name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    return where;
  }

  private adminReportInclude() {
    return {
      user: {
        select: {
          user_id: true,
          email: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          user_image: true,
        },
      },
    } satisfies Prisma.support_reportsInclude;
  }

  private toAdminReport(report: SupportReportWithUser): AdminSupportReportDto {
    return {
      id: report.id,
      category: report.category,
      title: report.title,
      description: report.description,
      status: report.status,
      user: {
        userId: report.user.user_id,
        email: report.user.email,
        name: this.formatUserName(report.user),
        imageUrl: report.user.user_image,
      },
      deviceInfo: report.device_info,
      userContext: report.user_context,
      createdAt: report.created_at.toISOString(),
      updatedAt: report.updated_at.toISOString(),
    };
  }

  private formatUserName(reportUser: SupportReportWithUser['user']) {
    const parts = [
      reportUser.name,
      reportUser.paternal_last_name,
      reportUser.maternal_last_name,
    ]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));

    return parts.length > 0 ? parts.join(' ') : null;
  }
}
