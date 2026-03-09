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
  CreateInstanceDto,
  UpdateInstanceDto,
  AssignRoleDto,
  UpdateRoleAssignmentDto,
  ClubInstanceType,
} from './dto';
import { AuthorizationResource, ClubRoles, RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, ClubRolesGuard, PermissionsGuard } from '../common/guards';
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
  @RequirePermissions('clubs:read')
  @ApiOperation({
    summary: 'Listar clubs',
    description:
      'Obtiene la lista de clubs con filtros opcionales y paginación',
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
  // INSTANCES
  // ========================================

  @Get(':clubId/instances')
  @RequirePermissions('club_instances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Obtener instancias del club',
    description: 'Lista todas las instancias (Aventureros, Conquistadores, GM)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Instancias del club' })
  async getInstances(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubsService.getInstances(clubId);
  }

  @Get(':clubId/instances/:type')
  @RequirePermissions('club_instances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener instancia por tipo' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({
    name: 'type',
    enum: ClubInstanceType,
    description: 'Tipo de instancia',
  })
  @ApiResponse({ status: 200, description: 'Instancia encontrada' })
  async getInstance(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('type') type: ClubInstanceType,
  ) {
    return this.clubsService.getInstance(clubId, type);
  }

  @Post(':clubId/instances')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy_director')
  @RequirePermissions('club_instances:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear instancia de club (requiere director o deputy director)',
    description:
      'Crea una nueva instancia (Aventureros, Conquistadores, Guías Mayores)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Instancia creada' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async createInstance(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateInstanceDto,
  ) {
    return this.clubsService.createInstance(clubId, dto);
  }

  @Patch(':clubId/instances/:type/:instanceId')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy_director', 'secretary')
  @RequirePermissions('club_instances:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Actualizar instancia (requiere director, deputy director o secretary)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'type', enum: ClubInstanceType })
  @ApiParam({ name: 'instanceId', type: Number })
  @ApiResponse({ status: 200, description: 'Instancia actualizada' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async updateInstance(
    @Param('instanceId', ParseIntPipe) instanceId: number,
    @Param('type') type: ClubInstanceType,
    @Body() dto: UpdateInstanceDto,
  ) {
    return this.clubsService.updateInstance(instanceId, type, dto);
  }

  // ========================================
  // MEMBERS & ROLES
  // ========================================

  @Get(':clubId/instances/:type/:instanceId/members')
  @RequirePermissions('club_roles:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar miembros de la instancia',
    description:
      'Retorna todos los miembros asignados a la instancia con sus roles',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'type', enum: ClubInstanceType })
  @ApiParam({ name: 'instanceId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de miembros' })
  async getMembers(
    @Param('instanceId', ParseIntPipe) instanceId: number,
    @Param('type') type: ClubInstanceType,
  ) {
    return this.clubsService.getMembers(instanceId, type);
  }

  @Post(':clubId/instances/:type/:instanceId/roles')
  @RequirePermissions('club_roles:assign')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Asignar rol a un miembro (requiere director, deputy director o secretary)',
    description: 'Asigna un rol específico a un usuario en la instancia',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'type', enum: ClubInstanceType })
  @ApiParam({ name: 'instanceId', type: Number })
  @ApiResponse({ status: 201, description: 'Rol asignado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async assignRole(
    @Param('type') type: ClubInstanceType,
    @Param('instanceId', ParseIntPipe) instanceId: number,
    @Body() dto: AssignRoleDto,
  ) {
    if (dto.instance_type && dto.instance_type !== type) {
      throw new BadRequestException(
        'instance_type in body must match route type',
      );
    }

    if (dto.instance_id && dto.instance_id !== instanceId) {
      throw new BadRequestException(
        'instance_id in body must match route instanceId',
      );
    }

    return this.clubsService.assignRole({
      ...dto,
      instance_type: type,
      instance_id: instanceId,
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
    @Param('assignmentId') assignmentId: string,
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
  async removeAssignment(@Param('assignmentId') assignmentId: string) {
    return this.clubsService.removeRoleAssignment(assignmentId);
  }
}
