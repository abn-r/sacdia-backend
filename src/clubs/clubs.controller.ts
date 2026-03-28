import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { ClubsService } from './clubs.service';
import {
  CreateClubDto,
  UpdateClubDto,
  CreateClubSectionDto,
  UpdateClubSectionDto,
  AssignRoleDto,
  UpdateRoleAssignmentDto,
} from './dto';
import {
  AuthorizationResource,
  ClubRoles,
  RequirePermissions,
} from '../common/decorators';
import {
  JwtAuthGuard,
  ClubRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('clubs')
@Controller('clubs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  // ========================================
  // CLUBS - CRUD
  // ========================================

  @Get()
  @ApiOperation({
    summary: 'Listar clubs',
    description:
      'Obtiene la lista de clubs con filtros opcionales y paginación. No requiere permiso clubs:read para permitir selección de club durante post-registro.',
  })
  @ApiQuery({ name: 'localFieldId', required: false, type: Number })
  @ApiQuery({ name: 'districtId', required: false, type: Number })
  @ApiQuery({ name: 'churchId', required: false, type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (1-indexed)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página (max 100)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de clubs' })
  async findAll(
    @Query('localFieldId', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @Query('districtId', new ParseIntPipe({ optional: true }))
    districtId?: number,
    @Query('churchId', new ParseIntPipe({ optional: true })) churchId?: number,
    @Query('active') active?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.clubsService.findAll(
      {
        localFieldId,
        districtId,
        churchId,
        active:
          active === 'true' ? true : active === 'false' ? false : undefined,
      },
      pagination,
    );
  }

  @Get(':clubId')
  @RequirePermissions('clubs:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener club por ID' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Club encontrado' })
  @ApiResponse({ status: 404, description: 'Club no encontrado' })
  async findOne(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubsService.findOne(clubId);
  }

  @Post()
  @RequirePermissions('clubs:create')
  @ApiOperation({ summary: 'Crear nuevo club' })
  @ApiResponse({ status: 201, description: 'Club creado' })
  async create(@Body() dto: CreateClubDto) {
    return this.clubsService.create(dto);
  }

  @Patch(':clubId')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy_director')
  @RequirePermissions('clubs:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Actualizar club (requiere rol director o deputy director)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Club actualizado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async update(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: UpdateClubDto,
  ) {
    return this.clubsService.update(clubId, dto);
  }

  @Delete(':clubId')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director')
  @RequirePermissions('clubs:delete')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Desactivar club (requiere rol director)' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Club desactivado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async remove(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubsService.remove(clubId);
  }

  // ========================================
  // SECTIONS
  // ========================================

  @Get(':clubId/sections')
  @ApiOperation({
    summary: 'Obtener secciones del club',
    description:
      'Lista todas las secciones (Aventureros, Conquistadores, GM). No requiere permiso club_sections:read para permitir selección de sección durante post-registro.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Secciones del club' })
  async getSections(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubsService.getSections(clubId);
  }

  @Get(':clubId/sections/:sectionId')
  @RequirePermissions('club_sections:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener sección por ID' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Sección encontrada' })
  async getSection(@Param('sectionId', ParseIntPipe) sectionId: number) {
    return this.clubsService.getSection(sectionId);
  }

  @Post(':clubId/sections')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy_director')
  @RequirePermissions('club_sections:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear sección de club (requiere director o deputy director)',
    description:
      'Crea una nueva sección (Aventureros, Conquistadores, Guías Mayores)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Sección creada' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async createSection(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateClubSectionDto,
  ) {
    return this.clubsService.createSection(clubId, dto);
  }

  @Patch(':clubId/sections/:sectionId')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy_director', 'secretary')
  @RequirePermissions('club_sections:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Actualizar sección (requiere director, deputy director o secretary)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Sección actualizada' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async updateSection(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: UpdateClubSectionDto,
  ) {
    return this.clubsService.updateSection(sectionId, dto);
  }

  // ========================================
  // MEMBERS & ROLES
  // ========================================

  @Get(':clubId/sections/:sectionId/members')
  @RequirePermissions('club_roles:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar miembros de la sección',
    description:
      'Retorna todos los miembros asignados a la sección con sus roles',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de miembros' })
  async getMembers(@Param('sectionId', ParseIntPipe) sectionId: number) {
    return this.clubsService.getMembers(sectionId);
  }

  @Post(':clubId/sections/:sectionId/roles')
  @RequirePermissions('club_roles:assign')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Asignar rol a un miembro (requiere director, deputy director o secretary)',
    description: 'Asigna un rol específico a un usuario en la sección',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 201, description: 'Rol asignado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async assignRole(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: AssignRoleDto,
  ) {
    if (dto.club_section_id && dto.club_section_id !== sectionId) {
      throw new BadRequestException(
        'club_section_id in body must match route sectionId',
      );
    }

    return this.clubsService.assignRole({
      ...dto,
      club_section_id: sectionId,
    });
  }
}

// ========================================
// ROLE ASSIGNMENTS CONTROLLER (Separate)
// ========================================

@ApiTags('club-roles')
@Controller('club-roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClubRolesController {
  constructor(private readonly clubsService: ClubsService) {}

  @Patch(':assignmentId')
  @RequirePermissions('club_roles:assign')
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
  @ApiOperation({ summary: 'Actualizar asignación de rol' })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Asignación actualizada' })
  async updateAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateRoleAssignmentDto,
  ) {
    return this.clubsService.updateRoleAssignment(assignmentId, dto);
  }

  @Delete(':assignmentId')
  @RequirePermissions('club_roles:revoke')
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
  @ApiOperation({ summary: 'Remover rol de miembro' })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Rol removido' })
  async removeAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.clubsService.removeRoleAssignment(assignmentId);
  }
}
