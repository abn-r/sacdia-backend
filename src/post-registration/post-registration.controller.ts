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
  AuthorizationResource,
  RequirePermissions,
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

  @Get('status')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Obtener estado del post-registro' })
  @ApiResponse({ status: 200, description: 'Estado actual' })
  async getStatus(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.getStatus(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-1/complete')
  @RequirePermissions('users:update')
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
  async completeStep1(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep1(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-2/complete')
  @RequirePermissions('users:update')
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
  async completeStep2(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep2(
      userId,
      this.buildActorContext(userId, request),
    );
  }

  @Post('step-3/complete')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar Paso 3: Selección de club',
    description:
      'Transacción completa: actualiza país/unión/campo, asigna rol member, inscribe en clase, marca post-registro completo',
  })
  @ApiResponse({
    status: 200,
    description: 'Paso 3 completado - POST-REGISTRO COMPLETO',
  })
  @ApiResponse({
    status: 400,
    description: 'Club no encontrado o datos inválidos',
  })
  async completeStep3(
    @Param('userId') userId: string,
    @Body() dto: CompleteClubSelectionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postRegistrationService.completeStep3(
      userId,
      dto,
      this.buildActorContext(userId, request),
    );
  }
}
