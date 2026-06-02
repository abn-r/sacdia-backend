import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PostRegistrationService } from './post-registration.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';
import {
  SensitiveUserSubresource,
  RequirePermissions,
  AuthorizationResource,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

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
  ) {}

  private buildActorContext(userId: string, request: AuthenticatedRequest) {
    const actorUserId = request.user?.sub ?? '';

    return {
      actorUserId,
      isOwner: actorUserId === userId,
    };
  }

  @Get('photo-status')
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
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar Paso 2: Información personal',
    description:
      'Valida: género, cumpleaños, bautismo, >= 1 contacto emergencia, representante legal si < 18',
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

  @Post('membership-request/cancel')
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
