import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  CreateEvidenceLinkDto,
} from './dto';
import {
  JwtAuthGuard,
  OptionalJwtAuthGuard,
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  @RequirePermissions('user_honors:submit')
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
  @RequirePermissions('user_honors:submit')
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

  @Post(':honorId/requirements/:requirementId/evidence/upload')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir evidencia (imagen o archivo) para un requisito' })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiParam({ name: 'requirementId', type: Number })
  async uploadEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    const evidenceType = imageTypes.includes(file.mimetype) ? 'IMAGE' : 'FILE';

    const maxSize = evidenceType === 'IMAGE' ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `Archivo demasiado grande. Máximo: ${maxSize / (1024 * 1024)}MB`,
      );
    }

    const data = await this.honorRequirementsService.uploadEvidence(
      userId, honorId, requirementId, file, evidenceType,
    );
    return { status: 'success', data };
  }

  @Post(':honorId/requirements/:requirementId/evidence/link')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @ApiOperation({ summary: 'Agregar enlace como evidencia para un requisito' })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiParam({ name: 'requirementId', type: Number })
  async addEvidenceLink(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: CreateEvidenceLinkDto,
  ) {
    const data = await this.honorRequirementsService.addEvidenceLink(
      userId, honorId, requirementId, dto.url,
    );
    return { status: 'success', data };
  }

  @Get(':honorId/requirements/:requirementId/evidence')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({ summary: 'Listar evidencias de un requisito' })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiParam({ name: 'requirementId', type: Number })
  async getEvidences(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
  ) {
    const data = await this.honorRequirementsService.getEvidences(
      userId, honorId, requirementId,
    );
    return { status: 'success', data };
  }

  @Delete(':honorId/requirements/:requirementId/evidence/:evidenceId')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:delete')
  @ApiOperation({ summary: 'Eliminar una evidencia de un requisito' })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiParam({ name: 'requirementId', type: Number })
  @ApiParam({ name: 'evidenceId', type: Number })
  async deleteEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Param('evidenceId', ParseIntPipe) evidenceId: number,
  ) {
    const data = await this.honorRequirementsService.deleteEvidence(
      userId, honorId, requirementId, evidenceId,
    );
    return { status: 'success', data };
  }
}
