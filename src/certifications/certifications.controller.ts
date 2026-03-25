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
import { CertificationsService } from './certifications.service';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { UpdateCertificationProgressDto } from './dto/update-progress.dto';
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
// CATÁLOGO DE CERTIFICACIONES (Público)
// ========================================

@ApiTags('certifications')
@Controller('certifications')
@UseGuards(OptionalJwtAuthGuard)
export class CertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Get('certifications')
  @ApiOperation({
    summary: 'Listar todas las certificaciones disponibles',
    description:
      'Obtiene lista paginada de certificaciones activas con count de módulos',
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
  @ApiResponse({ status: 200, description: 'Lista de certificaciones' })
  async findAll(@Query() paginationDto: PaginationDto) {
    const result = await this.certificationsService.findAll(paginationDto);
    return {
      status: 'success',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('certifications/:id')
  @ApiOperation({
    summary: 'Obtener detalles de una certificación',
    description:
      'Obtiene información completa de una certificación incluyendo módulos y secciones',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la certificación',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles de la certificación con módulos y secciones',
  })
  @ApiResponse({ status: 404, description: 'Certificación no encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.certificationsService.findOne(id);
    return {
      status: 'success',
      data,
    };
  }
}

// ========================================
// CERTIFICACIONES DE USUARIO (Autenticado)
// ========================================

@ApiTags('certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('certifications')
export class UserCertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Post('users/:userId/certifications/enroll')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Inscribirse en una certificación',
    description:
      'Permite a un Guía Mayor investido inscribirse en una certificación. Valida automáticamente elegibilidad.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiResponse({ status: 201, description: 'Inscripción creada exitosamente' })
  @ApiResponse({
    status: 403,
    description: 'Usuario no es Guía Mayor investido',
  })
  @ApiResponse({ status: 404, description: 'Certificación no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Usuario ya inscrito en esta certificación',
  })
  async enrollUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: EnrollCertificationDto,
  ) {
    const data = await this.certificationsService.enrollUser(userId, dto);
    return {
      status: 'success',
      data,
    };
  }

  @Get('users/:userId/certifications')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Listar certificaciones del usuario',
    description:
      'Obtiene todas las certificaciones en las que está inscrito el usuario con progreso',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de certificaciones del usuario con progreso',
  })
  async getUserCertifications(@Param('userId', ParseUUIDPipe) userId: string) {
    const data = await this.certificationsService.getUserCertifications(userId);
    return {
      status: 'success',
      data,
    };
  }

  @Get('users/:userId/certifications/:certificationId/progress')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Ver progreso detallado de una certificación',
    description:
      'Obtiene el progreso detallado por módulos y secciones de una certificación específica',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'certificationId',
    description: 'ID de la certificación',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Progreso detallado de la certificación',
  })
  @ApiResponse({
    status: 404,
    description: 'Inscripción en certificación no encontrada',
  })
  async getCertificationProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
  ) {
    const data = await this.certificationsService.getCertificationProgress(
      userId,
      certificationId,
    );
    return {
      status: 'success',
      data,
    };
  }

  @Patch('users/:userId/certifications/:certificationId/progress')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Actualizar progreso de una sección',
    description:
      'Marca una sección como completa/incompleta. Auto-completa módulo y certificación si todas las secciones/módulos están completos.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'certificationId',
    description: 'ID de la certificación',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Progreso actualizado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Módulo o sección inválidos para esta certificación',
  })
  @ApiResponse({
    status: 404,
    description: 'Inscripción en certificación no encontrada',
  })
  async updateProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Body() dto: UpdateCertificationProgressDto,
  ) {
    const data = await this.certificationsService.updateProgress(
      userId,
      certificationId,
      dto,
    );
    return {
      status: 'success',
      data,
    };
  }

  @Delete('users/:userId/certifications/:certificationId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Abandonar una certificación',
    description:
      'Desactiva la inscripción del usuario en una certificación (soft delete)',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID del usuario',
    example: 'uuid-123',
  })
  @ApiParam({
    name: 'certificationId',
    description: 'ID de la certificación',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Inscripción eliminada exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Inscripción en certificación no encontrada',
  })
  async deleteCertification(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('certificationId', ParseIntPipe) certificationId: number,
  ) {
    const data = await this.certificationsService.deleteCertification(
      userId,
      certificationId,
    );
    return {
      status: 'success',
      ...data,
    };
  }
}
