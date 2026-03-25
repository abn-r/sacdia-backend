import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { CreateClubEnrollmentDto, UpdateClubEnrollmentDto } from './dto';
import {
  RequirePermissions,
  AuthorizationResource,
  CurrentUser,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('club-enrollments')
@Controller('clubs/:clubId/sections/:sectionId/enrollments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClubEnrollmentsController {
  constructor(
    private readonly clubEnrollmentsService: ClubEnrollmentsService,
  ) {}

  @Post()
  @RequirePermissions('club_instances:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear inscripción anual',
    description:
      'Crea la inscripción del club para el año eclesiástico vigente. Solo puede existir una inscripción activa por sección y año.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 201, description: 'Inscripción creada' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una inscripción para esta sección y año',
  })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: CreateClubEnrollmentDto,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.clubEnrollmentsService.create(
      clubId,
      sectionId,
      dto,
      user.user_id,
    );
  }

  @Get()
  @RequirePermissions('club_instances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar inscripciones de la sección',
    description:
      'Lista todas las inscripciones de una sección con filtro opcional por año eclesiástico',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Filtrar por ID de año eclesiástico',
  })
  @ApiResponse({ status: 200, description: 'Lista de inscripciones' })
  async findAll(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.clubEnrollmentsService.findBySectionId(sectionId, { year });
  }

  @Get('current')
  @RequirePermissions('club_instances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Obtener inscripción vigente',
    description:
      'Retorna la inscripción activa de la sección para el año eclesiástico actual, o null si no existe',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Inscripción vigente, o null si la sección no tiene inscripción en el año actual',
  })
  async findCurrent(
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    const data = await this.clubEnrollmentsService.findCurrentBySectionId(sectionId);
    return { status: 'success', data };
  }

  @Patch(':enrollmentId')
  @RequirePermissions('club_instances:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Actualizar inscripción',
    description: 'Actualiza dirección y/o días de reunión de la inscripción',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiParam({ name: 'enrollmentId', type: String })
  @ApiResponse({ status: 200, description: 'Inscripción actualizada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async update(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() dto: UpdateClubEnrollmentDto,
  ) {
    return this.clubEnrollmentsService.update(enrollmentId, dto);
  }
}
