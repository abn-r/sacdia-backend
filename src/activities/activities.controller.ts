import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import 'multer';
import {
  FileValidationPipe,
  ALLOWED_MIME_TYPES,
} from '../common/pipes/file-validation.pipe';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import {
  CreateActivityDto,
  UpdateActivityDto,
  RecordAttendanceDto,
  CreateActivitySeriesDto,
  ExtendActivitySeriesDto,
} from './dto';
import {
  JwtAuthGuard,
  ClubRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  AuthorizationResource,
  ClubRoles,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('activities')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  // ========================================
  // ACTIVIDADES POR CLUB
  // ========================================

  @Get('clubs/:clubId/activities')
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar actividades del club',
    description: 'Obtiene todas las actividades de las instancias del club',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'clubTypeId', required: false, type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'activityTypeId', required: false, type: Number })
  @ApiQuery({ name: 'seriesId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista paginada de actividades' })
  async findByClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('active') active?: string,
    @Query('activityTypeId', new ParseIntPipe({ optional: true }))
    activityTypeId?: number,
    @Query('seriesId', new ParseIntPipe({ optional: true }))
    seriesId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Request() req?: any,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    // PermissionsGuard sets req.authorization after resolving the user profile.
    // For regular club members, effective.scope.club holds their active section.
    // For admins / club-managers (canManageClub bypass), scope.club may be null —
    // in that case we pass null so the service falls back to the broad club filter.
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        number | undefined) ?? null;

    return this.activitiesService.findByClub(
      clubId,
      {
        clubTypeId,
        active:
          active === 'true' ? true : active === 'false' ? false : undefined,
        activityTypeId,
        seriesId,
      },
      pagination,
      userSectionId,
    );
  }

  @Post('clubs/:clubId/activities')
  @UseGuards(ClubRolesGuard)
  @ClubRoles(
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'counselor',
  )
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear actividad',
    description:
      'Crea una nueva actividad para el club (requiere rol de liderazgo). Soporta múltiples instancias del mismo club mediante instances[]',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Actividad creada' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido para el tipo/instancia de club',
  })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateActivityDto,
    @Request() req: any,
  ) {
    return this.activitiesService.create(clubId, dto, req.user.sub);
  }

  @Post('clubs/:clubId/activity-series/preview')
  @UseGuards(ClubRolesGuard)
  @ClubRoles(
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'counselor',
  )
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Vista previa de serie de actividades',
    description:
      'Calcula las fechas que se crearían sin persistir. Mismos permisos que crear actividad.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Fechas calculadas' })
  async previewSeries(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateActivitySeriesDto,
  ) {
    return this.activitiesService.previewActivitySeries(clubId, dto);
  }

  @Post('clubs/:clubId/activity-series')
  @UseGuards(ClubRolesGuard)
  @ClubRoles(
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'counselor',
  )
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear serie de actividades',
    description:
      'Crea la cabecera y materializa N actividades independientes.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Serie creada' })
  async createSeries(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateActivitySeriesDto,
    @Request() req: any,
  ) {
    return this.activitiesService.createActivitySeries(
      clubId,
      dto,
      req.user.sub,
    );
  }

  @Get('activity-series/:seriesId')
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'activity_series', idParam: 'seriesId' })
  @ApiOperation({ summary: 'Obtener serie de actividades' })
  @ApiParam({ name: 'seriesId', type: Number })
  @ApiResponse({ status: 200, description: 'Serie encontrada' })
  @ApiResponse({ status: 404, description: 'Serie no encontrada' })
  async findSeries(@Param('seriesId', ParseIntPipe) seriesId: number) {
    return this.activitiesService.findActivitySeries(seriesId);
  }

  @Post('activity-series/:seriesId/cancel-future')
  @RequirePermissions('activities:delete')
  @AuthorizationResource({ type: 'activity_series', idParam: 'seriesId' })
  @ApiOperation({
    summary: 'Cancelar sesiones futuras de una serie',
    description:
      'Desactiva (soft delete) las actividades de la serie con fecha de hoy en adelante.',
  })
  @ApiParam({ name: 'seriesId', type: Number })
  async cancelFutureSeries(
    @Param('seriesId', ParseIntPipe) seriesId: number,
    @Request() req: any,
  ) {
    return this.activitiesService.cancelFutureActivitySeries(
      seriesId,
      req.user.sub,
    );
  }

  @Post('activity-series/:seriesId/extend')
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'activity_series', idParam: 'seriesId' })
  @ApiOperation({
    summary: 'Agregar más sesiones a una serie',
    description:
      'Alarga until y crea solo fechas que la serie aún no tiene. No resucita canceladas.',
  })
  @ApiParam({ name: 'seriesId', type: Number })
  async extendSeries(
    @Param('seriesId', ParseIntPipe) seriesId: number,
    @Body() dto: ExtendActivitySeriesDto,
    @Request() req: any,
  ) {
    return this.activitiesService.extendActivitySeries(
      seriesId,
      dto,
      req.user.sub,
    );
  }

  // ========================================
  // ACTIVIDAD INDIVIDUAL
  // ========================================

  @Get('activities/:activityId')
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @ApiOperation({ summary: 'Obtener actividad por ID' })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiResponse({ status: 200, description: 'Actividad encontrada' })
  @ApiResponse({ status: 404, description: 'Actividad no encontrada' })
  async findOne(@Param('activityId', ParseIntPipe) activityId: number) {
    return this.activitiesService.findOne(activityId);
  }

  @Patch('activities/:activityId')
  @RequirePermissions('activities:update')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @ApiOperation({ summary: 'Actualizar actividad' })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiResponse({ status: 200, description: 'Actividad actualizada' })
  async update(
    @Param('activityId', ParseIntPipe) activityId: number,
    @Body() dto: UpdateActivityDto,
    @Request() req: any,
  ) {
    return this.activitiesService.update(activityId, dto, req.user.sub);
  }

  @Delete('activities/:activityId')
  @RequirePermissions('activities:delete')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @ApiOperation({ summary: 'Desactivar actividad' })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiResponse({ status: 200, description: 'Actividad desactivada' })
  async remove(
    @Param('activityId', ParseIntPipe) activityId: number,
    @Request() req: any,
  ) {
    return this.activitiesService.remove(activityId, req.user.sub);
  }

  @Post('activities/:activityId/image')
  @RequirePermissions('activities:update')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir imagen de actividad' })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Imagen subida exitosamente' })
  @ApiResponse({ status: 400, description: 'Formato o tamaño inválido' })
  @ApiResponse({ status: 404, description: 'Actividad no encontrada' })
  async uploadImage(
    @Param('activityId', ParseIntPipe) activityId: number,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.activitiesService.uploadImage(activityId, file);
  }

  // ========================================
  // ASISTENCIA
  // ========================================

  @Post('activities/:activityId/attendance')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @ApiOperation({
    summary: 'Registrar asistencia',
    description: 'Registra la lista de usuarios que asistieron a la actividad',
  })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiResponse({ status: 201, description: 'Asistencia registrada' })
  async recordAttendance(
    @Param('activityId', ParseIntPipe) activityId: number,
    @Body() dto: RecordAttendanceDto,
  ) {
    return this.activitiesService.recordAttendance(activityId, dto);
  }

  @Get('activities/:activityId/attendance')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'activity', idParam: 'activityId' })
  @ApiOperation({
    summary: 'Obtener asistencia',
    description: 'Obtiene la lista de usuarios que asistieron a la actividad',
  })
  @ApiParam({ name: 'activityId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de asistentes' })
  async getAttendance(@Param('activityId', ParseIntPipe) activityId: number) {
    return this.activitiesService.getAttendance(activityId);
  }
}
