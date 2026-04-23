import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../common/guards';
import { CreateSupportReportDto } from './dto/create-support-report.dto';
import { SupportReportResponseDto } from './dto/support-report-response.dto';
import { SupportService } from './support.service';

interface JwtUser {
  sub: string;
  email: string;
}

@ApiTags('support')
@Controller('support')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /**
   * POST /api/v1/support/reports
   *
   * Rate-limit: 5 reportes/hora/usuario (Throttle override con nombre `long`
   * — el ThrottlerGuard global aplica los límites por usuario basado en el
   * JWT subject).
   */
  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ long: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Create a new support report',
    description:
      'Submits a bug report, feature request, or support ticket from the mobile app. ' +
      'Rate-limited to 5 reports per hour per user.',
  })
  @ApiBody({ type: CreateSupportReportDto })
  @ApiResponse({
    status: 201,
    description: 'Report created',
    type: SupportReportResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5/h)' })
  async createReport(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateSupportReportDto,
  ): Promise<SupportReportResponseDto> {
    return this.supportService.createReport(req.user.sub, dto);
  }
}
