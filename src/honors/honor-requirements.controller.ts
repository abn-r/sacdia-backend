import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { HonorRequirementsService } from './honor-requirements.service';
import {
  UpdateRequirementProgressDto,
  BulkUpdateRequirementProgressDto,
} from './dto';
import {
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  OwnerOrAdminGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';

// ========================================
// CATÁLOGO DE REQUISITOS DE HONORES (Público)
// ========================================

@ApiTags('honors')
@Controller('honors')
@UseGuards(OptionalJwtAuthGuard)
export class HonorRequirementsController {
  constructor(
    private readonly honorRequirementsService: HonorRequirementsService,
  ) {}

  @Get(':honorId/requirements')
  @ApiOperation({
    summary: 'Obtener requisitos de un honor',
    description:
      'Lista todos los requisitos activos de un honor ordenados por número',
  })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de requisitos del honor' })
  @ApiResponse({ status: 404, description: 'Honor no encontrado' })
  async getRequirements(@Param('honorId', ParseIntPipe) honorId: number) {
    const requirements =
      await this.honorRequirementsService.getRequirements(honorId);

    return {
      status: 'success',
      data: {
        honor_id: honorId,
        total_requirements: requirements.length,
        requirements,
      },
    };
  }
}

// ========================================
// PROGRESO DE REQUISITOS POR USUARIO (Autenticado)
// ========================================

@ApiTags('user-honors')
@Controller('users/:userId/honors')
@UseGuards(JwtAuthGuard, OwnerOrAdminGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserHonorRequirementsController {
  constructor(
    private readonly honorRequirementsService: HonorRequirementsService,
  ) {}

  @Get(':honorId/requirements/progress')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({
    summary: 'Obtener progreso de requisitos del usuario en un honor',
    description:
      'Retorna todos los requisitos del honor con el estado de completado del usuario',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Progreso de requisitos con conteo y porcentaje',
  })
  @ApiResponse({ status: 404, description: 'Usuario no inscrito en el honor' })
  async getUserProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
  ) {
    const data = await this.honorRequirementsService.getUserProgress(
      userId,
      honorId,
    );
    return { status: 'success', data };
  }

  @Patch(':honorId/requirements/progress/batch')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:update')
  @ApiOperation({
    summary: 'Actualizar progreso de múltiples requisitos',
    description:
      'Actualiza el estado de completado de varios requisitos en una sola operación atómica',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiBody({ type: BulkUpdateRequirementProgressDto })
  @ApiResponse({
    status: 200,
    description: 'Progreso actualizado con resumen',
  })
  @ApiResponse({
    status: 400,
    description: 'Uno o más requisitos no pertenecen al honor',
  })
  @ApiResponse({ status: 404, description: 'Usuario no inscrito en el honor' })
  async bulkUpdateProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: BulkUpdateRequirementProgressDto,
  ) {
    const data = await this.honorRequirementsService.bulkUpdateProgress(
      userId,
      honorId,
      dto,
    );
    return { status: 'success', data };
  }

  @Patch(':honorId/requirements/:requirementId/progress')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:update')
  @ApiOperation({
    summary: 'Actualizar progreso de un requisito individual',
    description:
      'Marca o desmarca un requisito como completado con notas opcionales',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiParam({ name: 'requirementId', type: Number })
  @ApiBody({ type: UpdateRequirementProgressDto })
  @ApiResponse({ status: 200, description: 'Progreso actualizado' })
  @ApiResponse({
    status: 400,
    description: 'El requisito no pertenece al honor',
  })
  @ApiResponse({ status: 404, description: 'Usuario no inscrito en el honor' })
  async updateProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Param('requirementId', ParseIntPipe) _requirementId: number,
    @Body() dto: UpdateRequirementProgressDto,
  ) {
    const data = await this.honorRequirementsService.updateProgress(
      userId,
      honorId,
      dto,
    );
    return { status: 'success', data };
  }
}
