import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import 'multer';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { PostRegistrationService } from './post-registration.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';
import { CompleteGuardianOnlyDto } from './dto/complete-guardian-only.dto';
import {
  SensitiveUserSubresource,
  RequirePermissions,
  AuthorizationResource,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';
import type { AuthPrincipal } from '../auth/acting-for/auth-principal';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../config/throttler.helpers';
import { ConsentEvidenceFilePipe } from '../guardianships/consent-evidence-file.pipe';
import { GuardianEvidenceService } from '../guardianships/guardian-evidence.service';

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
  };
};

@ApiTags('post-registration')
@Controller('users/:userId/post-registration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PostRegistrationController {
  constructor(
    private readonly postRegistrationService: PostRegistrationService,
    private readonly guardianEvidence: GuardianEvidenceService,
  ) {}

  private buildActorContext(userId: string, request: AuthenticatedRequest) {
    const actorUserId = request.user?.sub ?? '';

    return {
      actorUserId,
      isOwner: actorUserId === userId,
    };
  }

  @Get('photo-status')
  @ActingScope('self:read')
  @SensitiveUserSubresource('post_registration', 'read')
  @ApiOperation({
    summary: 'Verificar si el usuario tiene foto de perfil subida',
  })
  @ApiResponse({ status: 200, description: 'Estado de la foto de perfil' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — owner or admin access only',
  })
  async getPhotoStatus(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.postRegistrationService.getPhotoStatus(userId);
  }

  @Get('status')
  @ActingScope('self:read')
  @SensitiveUserSubresource('post_registration', 'read')
  @ApiOperation({ summary: 'Obtener estado del post-registro' })
  @ApiResponse({ status: 200, description: 'Estado actual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — owner or admin access only',
  })
  async getStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.getStatus(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-1/complete')
  @ActingScope('registration:write')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar Paso 1: Foto de perfil',
    description: 'Valida que el usuario tenga foto subida',
  })
  @ApiResponse({ status: 200, description: 'Paso 1 completado' })
  @ApiResponse({
    status: 400,
    description: 'Usuario no tiene foto de perfil',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires registration:complete',
  })
  async completeStep1(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep1(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-2/complete')
  @ActingScope('registration:write')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar Paso 2: Información personal',
    description:
      'Valida: género, cumpleaños, bautismo, >= 1 contacto emergencia',
  })
  @ApiResponse({ status: 200, description: 'Paso 2 completado' })
  @ApiResponse({
    status: 400,
    description: 'Faltan datos requeridos',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires registration:complete',
  })
  async completeStep2(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep2(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-3/complete')
  @ActingScope('registration:write')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar Paso 3: Selección de club',
    description:
      'Transacción completa: actualiza país/unión/campo, resuelve membresía de club y registra inscripción anual en enrollments antes de cerrar post-registro',
  })
  @ApiResponse({
    status: 200,
    description: 'Paso 3 completado - POST-REGISTRO COMPLETO',
  })
  @ApiResponse({
    status: 400,
    description: 'Club no encontrado o datos inválidos',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires registration:complete',
  })
  async completeStep3(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CompleteClubSelectionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep3(
      userId,
      dto,
      this.buildActorContext(userId, request),
    );
  }

  /**
   * Step 3 for a MINOR: the guardian acting for the child uploads the signed
   * consent form here, with the acting header (no more guardian-endpoint
   * workaround). `consent:evidence` lives only in the guardian scope sets: a
   * teen or a device is refused by the scope guard. The guardian comes from the
   * token (`actor_sub`) and the child from the token too (`sub`, which must be
   * the path id): nothing in the body can aim the write at another child.
   */
  @Post('step-3/consent-evidence')
  @ActingScope('consent:evidence')
  @SkipPermissions()
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 20 }))
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Subir la ficha de consentimiento firmada actuando por el menor',
    description:
      'Solo un tutor actuando (X-Acting-For) por ese menor. JPEG, PNG, WebP o PDF hasta 10 MB, campo multipart `file`; HEIC se rechaza. Misma validación y mismo contador (20/h por tutor) que POST /guardianships/me/dependents/:id/consent-evidence.',
  })
  @ApiResponse({
    status: 201,
    description: '{ evidence_id, content_type, size_bytes, uploaded_at }',
  })
  @ApiResponse({
    status: 403,
    description:
      'ACTING_FOR_SCOPE_DENIED (not acting for this user) o PRINCIPAL_SCOPE_DENIED (teen / dispositivo)',
  })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'GUARDIANSHIP_CONSENT_ALREADY_VERIFIED',
  })
  @ApiResponse({
    status: 503,
    description: 'GUARDIANSHIP_EVIDENCE_UNAVAILABLE',
  })
  async uploadConsentEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() principal: AuthPrincipal,
    @UploadedFile(new ConsentEvidenceFilePipe()) file: Express.Multer.File,
  ) {
    return {
      status: 'success',
      data: await this.guardianEvidence.uploadWhileActing(
        principal,
        userId,
        file,
      ),
    };
  }

  // Deliberately NO @ActingScope: a guardian acting for a dependent must never
  // close the guardian's own post-registration (denied by default while acting).
  @Post('step-3/guardian-only')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paso 3 alterno: "Solo soy tutor de menores"',
    description:
      'Cierra el post-registro de un adulto sin elegir club. Solo el propio usuario; requiere cuenta y mayoría de edad del país. La geografía es opcional y no exige dependientes existentes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Post-registro completado (data.mode = guardian_only)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — requires registration:complete, or called while acting for a dependent',
  })
  @ApiResponse({
    status: 422,
    description: 'POST_REG_GUARDIAN_ONLY_REQUIRES_ADULT',
  })
  async completeGuardianOnly(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CompleteGuardianOnlyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeGuardianOnly(
      userId,
      dto,
      this.buildActorContext(userId, request),
    );
  }

  @Post('membership-request/cancel')
  @ActingScope('registration:write')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar solicitud pendiente de membresía',
    description:
      'Permite al usuario cancelar su solicitud pendiente y volver a elegir club/sección en post-registro',
  })
  @ApiResponse({
    status: 200,
    description: 'Solicitud pendiente cancelada',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — owner self-service or registration:complete',
  })
  @ApiResponse({
    status: 404,
    description: 'Solicitud pendiente no encontrada',
  })
  async cancelPendingMembershipRequest(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.cancelPendingMembershipRequest(
      userId,
      this.buildActorContext(userId, request),
    );
  }
}
