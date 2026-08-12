import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import {
  CertificationReviewService,
  type CertificationReviewActor,
} from '../review/certification-review.service';
import type { CertificationRequirementStatus } from '../domain/certification-definition.types';
import {
  ApproveCertificationRequirementDto,
  RequestCertificationRequirementChangesDto,
} from '../dto/review-certification-requirement.dto';

type UserPayload = { sub?: string; user_id?: string; userId?: string };
type RequestWithProfile = {
  user?: UserPayload;
  authorizationProfile?: ResolvedAuthorizationProfile;
};

@ApiTags('certifications - review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@RequirePermissions('certifications:review')
@Controller('certifications/reviews')
export class CertificationReviewController {
  constructor(private readonly reviewService: CertificationReviewService) {}

  @Get('requirements')
  @ApiOperation({
    summary: 'Bandeja de requisitos pendientes de revisión',
    description:
      'Lista requisitos filtrados por el alcance institucional del revisor y, opcionalmente, por estado.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({ status: 200, description: 'Bandeja de revisión' })
  async getTray(
    @Req() request: RequestWithProfile,
    @Query('status') status?: CertificationRequirementStatus,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.reviewService.getTray(actor, { status });
    return { status: 'success', data };
  }

  @Get('requirements/:progressId')
  @ApiOperation({
    summary: 'Detalle de un requisito en revisión',
    description:
      'Devuelve respuestas, evidencias e historial de un requisito dentro del alcance institucional del revisor.',
  })
  @ApiParam({ name: 'progressId', description: 'ID del progreso de sección' })
  @ApiResponse({ status: 200, description: 'Detalle del requisito' })
  @ApiResponse({
    status: 403,
    description: 'Fuera del alcance institucional del revisor',
  })
  async getDetail(
    @Req() request: RequestWithProfile,
    @Param('progressId', ParseIntPipe) progressId: number,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.reviewService.getDetail(actor, progressId);
    return { status: 'success', data };
  }

  @Post('requirements/:progressId/approve')
  @ApiOperation({
    summary: 'Aprobar un requisito enviado a revisión',
    description: 'Solo permitido cuando el requisito está en estado SUBMITTED.',
  })
  @ApiParam({ name: 'progressId', description: 'ID del progreso de sección' })
  @ApiResponse({ status: 201, description: 'Requisito aprobado' })
  @ApiResponse({
    status: 409,
    description: 'Transición inválida o conflicto de concurrencia',
  })
  async approve(
    @Req() request: RequestWithProfile,
    @Param('progressId', ParseIntPipe) progressId: number,
    @Body() dto: ApproveCertificationRequirementDto,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.reviewService.approve(actor, progressId, dto);
    return { status: 'success', data };
  }

  @Post('requirements/:progressId/request-changes')
  @ApiOperation({
    summary: 'Devolver un requisito con comentario obligatorio',
    description:
      'Transiciona el requisito de SUBMITTED a CHANGES_REQUESTED registrando el motivo.',
  })
  @ApiParam({ name: 'progressId', description: 'ID del progreso de sección' })
  @ApiResponse({ status: 201, description: 'Requisito devuelto' })
  async requestChanges(
    @Req() request: RequestWithProfile,
    @Param('progressId', ParseIntPipe) progressId: number,
    @Body() dto: RequestCertificationRequirementChangesDto,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.reviewService.requestChanges(
      actor,
      progressId,
      dto,
    );
    return { status: 'success', data };
  }

  private resolveActor(request: RequestWithProfile): CertificationReviewActor {
    const userId =
      request.user?.sub ?? request.user?.user_id ?? request.user?.userId;
    const profile = request.authorizationProfile;
    if (!userId || !profile) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    const roles = new Set(
      profile.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
    const localFieldId =
      profile.authorization.effective.scope.global.local_field?.id;
    const globalAccess =
      (roles.has('admin') || roles.has('super-admin')) &&
      typeof localFieldId !== 'number';

    return {
      userId,
      localFieldId: typeof localFieldId === 'number' ? localFieldId : undefined,
      globalAccess,
    };
  }
}
