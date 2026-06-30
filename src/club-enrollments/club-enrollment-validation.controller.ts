import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ClubEnrollmentsService,
  type ClubEnrollmentStatus,
} from './club-enrollments.service';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

type CurrentUserPayload = {
  sub?: string;
  user_id?: string;
};

@ApiTags('club-enrollments')
@Controller('club-enrollments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClubEnrollmentValidationController {
  constructor(
    private readonly clubEnrollmentsService: ClubEnrollmentsService,
  ) {}

  @Get('validation/queue')
  @RequirePermissions('club_instances:update')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Listar inscripciones anuales pendientes de Campo Local',
    description:
      'Lista matrículas anuales de club pendientes de aprobación/rechazo por Campo Local, filtradas por alcance territorial del usuario.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'ecclesiastical_year_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'club_type_id', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Cola de validación anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires club_instances:update',
  })
  async findValidationQueue(
    @Query('search') search?: string,
    @Query('status') status?: ClubEnrollmentStatus | 'all',
    @Query('ecclesiastical_year_id') ecclesiasticalYearIdRaw?: string,
    @Query('local_field_id') localFieldIdRaw?: string,
    @Query('club_type_id') clubTypeIdRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Req()
    request?: { authorizationProfile?: ResolvedAuthorizationProfile },
  ) {
    const data = await this.clubEnrollmentsService.findValidationQueue(
      {
        search,
        status,
        ecclesiastical_year_id: this.parseOptionalInt(ecclesiasticalYearIdRaw),
        local_field_id: this.parseOptionalInt(localFieldIdRaw),
        club_type_id: this.parseOptionalInt(clubTypeIdRaw),
        page: this.parseOptionalInt(pageRaw),
        limit: this.parseOptionalInt(limitRaw),
      },
      request?.authorizationProfile,
    );

    return { status: 'success', data };
  }

  @Post(':enrollmentId/approve')
  @RequirePermissions('club_instances:update')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Aprobar inscripción anual del club',
    description:
      'Campo Local aprueba la inscripción anual. Al aprobarse queda activa y se intenta crear la Carpeta Anual de Evidencias.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'UUID de inscripción anual' })
  @ApiResponse({ status: 201, description: 'Inscripción aprobada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async approve(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const actorId = user.user_id ?? user.sub ?? 'unknown';
    const data = await this.clubEnrollmentsService.approve(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }

  @Post(':enrollmentId/reject')
  @RequirePermissions('club_instances:update')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Rechazar inscripción anual del club',
    description:
      'Campo Local rechaza la inscripción anual para que el club corrija datos y vuelva a enviarla.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'UUID de inscripción anual' })
  @ApiResponse({ status: 201, description: 'Inscripción rechazada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async reject(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const actorId = user.user_id ?? user.sub ?? 'unknown';
    const data = await this.clubEnrollmentsService.reject(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }

  private parseOptionalInt(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
}
