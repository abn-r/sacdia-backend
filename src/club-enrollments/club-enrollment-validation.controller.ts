import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { ParseUuidParamPipe } from '../common/pipes/parse-uuid-param.pipe';
import { namedThrottle } from '../config/throttler.helpers';
import { ClubEnrollmentReviewService } from './club-enrollment-review.service';
import { ClubEnrollmentQueueQueryDto, RejectClubEnrollmentDto } from './dto';

type CurrentUserPayload = {
  sub?: string;
  user_id?: string;
};

/**
 * Validation of annual enrollments. The permission `club_enrollments:validate`
 * opens the door; the scope (admin, Local Field, Union, Division, coordinator
 * territory, district pastor) is enforced in the service, and an out-of-scope
 * id answers 404.
 */
@ApiTags('club-enrollments')
@Controller('club-enrollments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClubEnrollmentValidationController {
  constructor(private readonly review: ClubEnrollmentReviewService) {}

  @Get('validation/queue')
  @RequirePermissions('club_enrollments:validate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Cola de validación de inscripciones anuales en mi alcance',
    description:
      'Inscripciones anuales de las secciones que el revisor cubre (admin, Campo Local, Unión, División, coordinación o pastor de distrito). Filtra por estado (pendientes por defecto), año (vigente por defecto), campo local, tipo de club y texto. `meta.counts` cubre todo el alcance del año sin el filtro de estado.',
  })
  @ApiResponse({ status: 200, description: 'Cola de validación anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires club_enrollments:validate',
  })
  async findValidationQueue(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ClubEnrollmentQueueQueryDto,
  ) {
    const data = await this.review.findQueue(this.actorId(user), query);
    return { status: 'success', data };
  }

  @Post(':enrollmentId/approve')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @RequirePermissions('club_enrollments:validate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Aprobar inscripción anual de la sección',
    description:
      'Aprobar deja la inscripción activa, registra quién la revisó e intenta crear la Carpeta Anual de Evidencias. Avisa a la dirección y a quien la envió. Aprobar una inscripción ya activa responde 200 sin cambios.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'UUID de inscripción anual' })
  @ApiResponse({ status: 200, description: 'Inscripción aprobada' })
  @ApiResponse({
    status: 403,
    description: 'CE_SELF_REVIEW — el revisor tiene un cargo en la sección',
  })
  @ApiResponse({
    status: 404,
    description: 'Inscripción no encontrada o fuera del alcance del revisor',
  })
  @ApiResponse({
    status: 409,
    description: 'CE_ENROLLMENT_NOT_PENDING — ya no está pendiente',
  })
  async approve(
    @Param('enrollmentId', ParseUuidParamPipe) enrollmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.review.approve(this.actorId(user), enrollmentId);
    return { status: 'success', data };
  }

  @Post(':enrollmentId/reject')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @RequirePermissions('club_enrollments:validate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Rechazar inscripción anual de la sección',
    description:
      'Rechazar exige un motivo (5 a 500 caracteres). La sección corrige y vuelve a enviar. Avisa a la dirección y a quien la envió.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'UUID de inscripción anual' })
  @ApiResponse({ status: 200, description: 'Inscripción rechazada' })
  @ApiResponse({
    status: 403,
    description: 'CE_SELF_REVIEW — el revisor tiene un cargo en la sección',
  })
  @ApiResponse({
    status: 404,
    description: 'Inscripción no encontrada o fuera del alcance del revisor',
  })
  @ApiResponse({
    status: 409,
    description: 'CE_ENROLLMENT_NOT_PENDING — ya no está pendiente',
  })
  async reject(
    @Param('enrollmentId', ParseUuidParamPipe) enrollmentId: string,
    @Body() dto: RejectClubEnrollmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.review.reject(
      this.actorId(user),
      enrollmentId,
      dto,
    );
    return { status: 'success', data };
  }

  private actorId(user: CurrentUserPayload): string {
    return user.user_id ?? user.sub ?? 'unknown';
  }
}
