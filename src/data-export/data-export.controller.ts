import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DataExportService } from './data-export.service';
import { CreateDataExportDto } from './dto/create-data-export.dto';
import {
  DataExportListResponseDto,
  DataExportDownloadResponseDto,
  DataExportCreateResponseDto,
  DataExportRateLimitResponseDto,
} from './dto/data-export-response.dto';
import { JwtAuthGuard } from '../common/guards';

interface JwtUser {
  sub: string;
  email: string;
}

@ApiTags('data-export')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DataExportController {
  constructor(private readonly dataExportService: DataExportService) {}

  /**
   * POST /api/v1/users/me/data-export
   * Request a GDPR data export.
   * Rate-limited: 1 completed export per 24h per user.
   * Returns 201 (new export created), 200 (existing in-progress), or 429 (cooldown).
   */
  @Post('data-export')
  @Throttle({
    short: { limit: 1, ttl: 60000 },
    medium: { limit: 2, ttl: 3600000 },
  })
  @ApiOperation({
    summary: 'Request a GDPR data export',
    description:
      'Creates a new data export job. Returns 200 with existing export if one is already in progress, ' +
      '201 when a new export is enqueued, or 429 if a completed export exists within the last 24 hours.',
  })
  @ApiResponse({
    status: 201,
    description: 'Export job enqueued successfully',
    type: DataExportCreateResponseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'An export is already in progress — returns existing export',
    type: DataExportCreateResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'A completed export already exists in the last 24h',
    type: DataExportRateLimitResponseDto,
  })
  async requestExport(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateDataExportDto,
    @Res() res: Response,
  ) {
    const userId = req.user.sub;
    const result = await this.dataExportService.requestExport(
      userId,
      dto.format ?? 'json',
    );
    return res.status(result.status).json(result.data);
  }

  /**
   * GET /api/v1/users/me/data-exports
   * List all data export requests for the authenticated user.
   */
  @Get('data-exports')
  @ApiOperation({
    summary: 'List all data export requests for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of export requests',
    type: DataExportListResponseDto,
  })
  async listExports(@Req() req: Request & { user: JwtUser }) {
    return this.dataExportService.listExports(req.user.sub);
  }

  /**
   * GET /api/v1/users/me/data-exports/:exportId/download
   * Get a presigned download URL for a ready export (TTL 15 min).
   *
   * Status codes:
   *   200 — ready, returns { url, expires_at }
   *   404 — not found or cross-user
   *   409 — pending or processing
   *   410 — expired
   *   422 — failed
   */
  @Get('data-exports/:exportId/download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get presigned download URL for a ready export',
    description:
      'Returns a 15-minute presigned R2 URL. ' +
      '409 if still processing, 410 if expired, 422 if failed, 404 if not found.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned download URL',
    type: DataExportDownloadResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Export not found or belongs to another user',
  })
  @ApiResponse({ status: 409, description: 'Export is pending or processing' })
  @ApiResponse({ status: 410, description: 'Export has expired' })
  @ApiResponse({
    status: 422,
    description: 'Export failed — check failure_reason',
  })
  async getDownloadUrl(
    @Req() req: Request & { user: JwtUser },
    @Param('exportId') exportId: string,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress;

    return this.dataExportService.getDownloadUrl(
      req.user.sub,
      exportId,
      ipAddress,
    );
  }
}
