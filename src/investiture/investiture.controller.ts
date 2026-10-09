import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { InvestitureService } from './investiture.service';
import { ExpireOverdueEnrollmentsDto, ReleaseLegacyLocksDto } from './dto';
import { LegacyLockReleaseService } from './legacy-lock-release.service';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  GlobalRoles,
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';

@ApiTags('investiture')
@ApiBearerAuth()
@Controller()
export class InvestitureController {
  constructor(
    private readonly investitureService: InvestitureService,
    private readonly legacyLockRelease: LegacyLockReleaseService,
  ) {}

  @Post('admin/classes/enrollments/expire-overdue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin')
  @RequirePermissions('catalogs:update')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Vencer manualmente enrollments atrasados por duración de clase',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado del vencimiento manual o dry-run',
  })
  async expireOverdueEnrollments(
    @Body() dto: ExpireOverdueEnrollmentsDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.expireOverdueEnrollments(
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('admin/investiture/legacy-locks/release')
  @HttpCode(HttpStatus.OK)
  @SkipPermissions()
  @ApiOperation({
    summary:
      'Soltar locked_for_validation de expedientes de la vía anterior (solo super-admin; dry_run por defecto)',
  })
  @ApiResponse({
    status: 200,
    description: 'Candidatos, omitidos por PENDING y liberados',
  })
  @ApiResponse({ status: 403, description: 'SUPER_ADMIN_WRITE_REQUIRED' })
  async releaseLegacyLocks(@Body() dto: ReleaseLegacyLocksDto, @Request() req) {
    const data = await this.legacyLockRelease.release(req.user.sub, dto);
    return { status: 'success', data };
  }

  // ========================================
  // GET /investiture/enrollments/:enrollmentId/history
  // ========================================

  @Get('investiture/enrollments/:enrollmentId/history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('investiture:read')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: 'Historial de validación de investidura de un enrollment',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  @ApiResponse({
    status: 403,
    description: 'Sin acceso al historial de este enrollment',
  })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  async getHistory(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    // Authorization is resolved inside the service via DB lookup — JWT payload does NOT carry roles
    const data = await this.investitureService.getHistory(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }

  @Get('enrollments/:enrollmentId/investiture-history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('investiture:read')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: '[LEGACY] Historial de validación de investidura de un enrollment',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  async getHistoryLegacy(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.getHistory(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }
}
