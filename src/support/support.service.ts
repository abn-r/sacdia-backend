import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportReportDto } from './dto/create-support-report.dto';
import { SupportReportResponseDto } from './dto/support-report-response.dto';
import * as Sentry from '@sentry/node';

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
        // Prisma InputJsonValue — castear a `any` para esquivar la firma
        // estricta (`JsonValue` no acepta Record<string, unknown> directo).
        device_info: dto.deviceInfo as unknown as object,
        user_context:
          dto.userContext !== undefined
            ? (dto.userContext as unknown as object)
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
}
