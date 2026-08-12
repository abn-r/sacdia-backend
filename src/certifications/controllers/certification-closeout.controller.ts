import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
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
  CertificationCloseoutService,
  type CertificationCloseoutReviewActor,
} from '../closeout/certification-closeout.service';
import {
  ConfirmCertificationCloseoutEvidenceDto,
  PresignCertificationCloseoutEvidenceDto,
  RequestCertificationCloseoutChangesDto,
} from '../dto/review-certification-closeout.dto';

type UserPayload = { sub?: string; user_id?: string; userId?: string };
type RequestWithProfile = {
  user?: UserPayload;
  authorizationProfile?: ResolvedAuthorizationProfile;
};

@ApiTags('certifications - closeout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('certifications')
export class CertificationCloseoutController {
  constructor(private readonly closeoutService: CertificationCloseoutService) {}

  // ---------------------------------------------------------------------------
  // Participant: closeout evidence + submit-final
  // ---------------------------------------------------------------------------

  @Post('users/:userId/certifications/:certificationId/closeout-evidence/presign')
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Solicitar URL firmada para subir el comprobante de junta',
    description:
      'Genera una clave de objeto controlada por el servidor y una URL firmada de subida a R2. Reemplaza cualquier comprobante previo aún no aprobado.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'certificationId', description: 'ID de la certificación' })
  @ApiResponse({ status: 201, description: 'URL de subida generada' })
  async presignCloseoutEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Body() dto: PresignCertificationCloseoutEvidenceDto,
  ) {
    const data = await this.closeoutService.presignCloseoutEvidence(
      userId,
      certificationId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('users/:userId/certifications/:certificationId/closeout-evidence/confirm')
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Confirmar que el comprobante de junta fue subido a R2',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'certificationId', description: 'ID de la certificación' })
  @ApiResponse({ status: 201, description: 'Comprobante confirmado' })
  async confirmCloseoutEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Body() dto: ConfirmCertificationCloseoutEvidenceDto,
  ) {
    const data = await this.closeoutService.confirmCloseoutEvidence(
      userId,
      certificationId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('users/:userId/certifications/:certificationId/submit-final')
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Enviar la inscripción a revisión final',
    description:
      'Requiere todos los requisitos obligatorios APPROVED y el comprobante de junta CONFIRMED.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'certificationId', description: 'ID de la certificación' })
  @ApiResponse({ status: 201, description: 'Inscripción enviada a revisión final' })
  @ApiResponse({
    status: 400,
    description: 'Faltan requisitos aprobados o el comprobante de junta',
  })
  async submitFinal(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
  ) {
    const data = await this.closeoutService.submitFinal(
      userId,
      certificationId,
    );
    return { status: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // Reviewer: final tray
  // ---------------------------------------------------------------------------

  @Get('reviews/final')
  @RequirePermissions('certifications:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Bandeja de cierres pendientes de revisión final',
  })
  @ApiResponse({ status: 200, description: 'Bandeja de cierres' })
  async getFinalTray(@Req() request: RequestWithProfile) {
    const actor = this.resolveActor(request);
    const data = await this.closeoutService.getFinalTray(actor);
    return { status: 'success', data };
  }

  @Post('reviews/final/:enrollmentId/approve-closeout-evidence')
  @RequirePermissions('certifications:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Aprobar el comprobante de junta y avanzar la inscripción',
    description:
      'Transiciona la inscripción de SUBMITTED_FOR_FINAL_REVIEW a APPROVED.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiResponse({ status: 201, description: 'Comprobante aprobado' })
  async approveCloseoutEvidence(
    @Req() request: RequestWithProfile,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.closeoutService.approveCloseoutEvidence(
      actor,
      enrollmentId,
    );
    return { status: 'success', data };
  }

  @Post('reviews/final/:enrollmentId/request-changes')
  @RequirePermissions('certifications:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Devolver el cierre con comentario obligatorio',
    description:
      'Transiciona la inscripción de SUBMITTED_FOR_FINAL_REVIEW a CHANGES_REQUESTED.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiResponse({ status: 201, description: 'Cierre devuelto' })
  async requestChanges(
    @Req() request: RequestWithProfile,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: RequestCertificationCloseoutChangesDto,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.closeoutService.requestChanges(
      actor,
      enrollmentId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('reviews/final/:enrollmentId/certify')
  @RequirePermissions('certifications:certify')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Certificar una inscripción válida',
    description:
      'Vuelve a comprobar todos los requisitos obligatorios APPROVED y el comprobante de junta APPROVED dentro de una transacción. Idempotente.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiResponse({ status: 201, description: 'Inscripción certificada' })
  @ApiResponse({
    status: 400,
    description: 'Falta una condición para certificar',
  })
  async certify(
    @Req() request: RequestWithProfile,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
  ) {
    const actor = this.resolveActor(request);
    const data = await this.closeoutService.certify(actor, enrollmentId);
    return { status: 'success', data };
  }

  private resolveActor(
    request: RequestWithProfile,
  ): CertificationCloseoutReviewActor {
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
