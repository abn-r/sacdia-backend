import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { FoldersService } from './folders.service';
import { UpdateSectionRecordDto } from './dto/update-section-record.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import {
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';

// ========================================
// CATÁLOGO DE CARPETAS (Público)
// ========================================

@ApiTags('folders')
@Controller('folders')
@UseGuards(OptionalJwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get('folders')
  @ApiOperation({
    summary: 'Listar templates de carpetas disponibles',
    description:
      'Obtiene lista paginada de templates de carpetas activos con count de módulos',
  })
  @ApiQuery({
    name: 'club_type',
    required: false,
    description:
      'Filtrar por tipo de club (1: Aventureros, 2: Conquistadores, 3: Guías Mayores)',
    example: 2,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Número de página (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Resultados por página (default: 50, max: 100)',
    example: 50,
  })
  @ApiResponse({ status: 200, description: 'Lista de templates de carpetas' })
  async findAll(
    @Query('club_type', ParseIntPipe) clubTypeId?: number,
    @Query() paginationDto?: PaginationDto,
  ) {
    const result = await this.foldersService.findAll(clubTypeId, paginationDto);
    return {
      status: 'success',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('folders/:id')
  @ApiOperation({
    summary: 'Obtener detalles de un template de carpeta',
    description:
      'Obtiene información completa de un template de carpeta incluyendo módulos y secciones con puntos',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del template de carpeta',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del template con módulos y secciones',
  })
  @ApiResponse({
    status: 404,
    description: 'Template de carpeta no encontrado',
  })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.foldersService.findOne(id);
    return {
      status: 'success',
      data,
    };
  }
}

// ========================================
// CARPETAS DE USUARIO (Autenticado)
// ========================================

@ApiTags('folders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('folders')
export class UserFoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Post('users/:userId/folders/:folderId/enroll')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Inscribirse en una carpeta',
    description:
      'Asigna un template de carpeta a un usuario. Valida que el usuario pertenezca a un club del tipo requerido.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'folderId',
    description: 'ID del template de carpeta',
    example: 1,
  })
  @ApiResponse({ status: 201, description: 'Carpeta asignada exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Usuario no pertenece a un club del tipo requerido',
  })
  @ApiResponse({
    status: 404,
    description: 'Template de carpeta no encontrado',
  })
  @ApiResponse({
    status: 409,
    description: 'Usuario ya tiene una asignación activa para esta carpeta',
  })
  async enrollUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('folderId', ParseIntPipe) folderId: number,
  ) {
    const data = await this.foldersService.enrollUser(userId, folderId);
    return {
      status: 'success',
      data,
    };
  }

  @Get('users/:userId/folders')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Listar carpetas asignadas del usuario',
    description:
      'Obtiene todas las carpetas asignadas al usuario con progreso y estado',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de carpetas del usuario con progreso',
  })
  async getUserFolders(@Param('userId', ParseUUIDPipe) userId: string) {
    const data = await this.foldersService.getUserFolders(userId);
    return {
      status: 'success',
      data,
    };
  }

  @Get('users/:userId/folders/:folderId/progress')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Ver progreso detallado de una carpeta',
    description:
      'Obtiene el progreso detallado por módulos y secciones con evidencias',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'folderId',
    description: 'ID del template de carpeta',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Progreso detallado de la carpeta',
  })
  @ApiResponse({
    status: 404,
    description: 'Asignación de carpeta no encontrada',
  })
  async getFolderProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('folderId', ParseIntPipe) folderId: number,
  ) {
    const data = await this.foldersService.getFolderProgress(userId, folderId);
    return {
      status: 'success',
      data,
    };
  }

  @Patch(
    'users/:userId/folders/:folderId/modules/:moduleId/sections/:sectionId',
  )
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Actualizar progreso de una sección',
    description:
      'Registra evidencias y puntos obtenidos en una sección. Auto-completa módulo y carpeta según criterios.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'folderId',
    description: 'ID del template de carpeta',
    example: 1,
  })
  @ApiParam({
    name: 'moduleId',
    description: 'ID del módulo',
    example: 1,
  })
  @ApiParam({
    name: 'sectionId',
    description: 'ID de la sección',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Progreso actualizado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Puntos exceden el máximo o módulo/sección inválidos',
  })
  @ApiResponse({
    status: 404,
    description: 'Asignación de carpeta no encontrada',
  })
  async updateSectionProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('folderId', ParseIntPipe) folderId: number,
    @Param('moduleId', ParseIntPipe) moduleId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: UpdateSectionRecordDto,
  ) {
    const data = await this.foldersService.updateSectionProgress(
      userId,
      folderId,
      moduleId,
      sectionId,
      dto,
    );
    return {
      status: 'success',
      data,
    };
  }

  @Delete('users/:userId/folders/:folderId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Abandonar una carpeta',
    description: 'Desactiva la asignación de carpeta del usuario (soft delete)',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'folderId',
    description: 'ID del template de carpeta',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Asignación eliminada exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Asignación de carpeta no encontrada',
  })
  async deleteAssignment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('folderId', ParseIntPipe) folderId: number,
  ) {
    const data = await this.foldersService.deleteAssignment(userId, folderId);
    return {
      status: 'success',
      ...data,
    };
  }
}
