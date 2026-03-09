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
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CamporeesService } from './camporees.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateCamporeeDto, UpdateCamporeeDto, RegisterMemberDto } from './dto';

@ApiTags('camporees')
@Controller('camporees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CamporeesController {
  constructor(private readonly camporeesService: CamporeesService) {}

  // ========================================
  // CAMPOREES
  // ========================================

  @Get()
  @ApiOperation({
    summary: 'Listar camporees',
    description: 'Obtiene todos los camporees disponibles',
  })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiResponse({ status: 200, description: 'Lista paginada de camporees' })
  async findAll(
    @Request() req: any,
    @Query('active') active?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.camporeesService.findAll(
      {
        active:
          active === 'true' ? true : active === 'false' ? false : undefined,
      },
      pagination,
      req.authorization,
    );
  }

  @Get(':camporeeId')
  @ApiOperation({ summary: 'Obtener camporee por ID' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiResponse({ status: 200, description: 'Camporee encontrado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async findOne(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.findOne(camporeeId);
  }

  @Post()
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Crear camporee',
    description:
      'Crea un nuevo camporee (requiere permisos de actividades en el contexto activo)',
  })
  @ApiResponse({ status: 201, description: 'Camporee creado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async create(@Body() dto: CreateCamporeeDto, @Request() req: any) {
    return this.camporeesService.create(dto, req.user.sub, req.authorization);
  }

  @Patch(':camporeeId')
  @RequirePermissions('activities:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Actualizar camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Camporee actualizado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async update(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateCamporeeDto,
  ) {
    return this.camporeesService.update(camporeeId, dto);
  }

  @Delete(':camporeeId')
  @RequirePermissions('activities:delete')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Desactivar camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Camporee desactivado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async remove(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.remove(camporeeId);
  }

  // ========================================
  // INSCRIPCIONES
  // ========================================

  @Post(':camporeeId/register')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Registrar miembro en camporee',
    description: 'Registra un miembro en el camporee con validación de seguro',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 201, description: 'Miembro registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async registerMember(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: RegisterMemberDto,
  ) {
    return this.camporeesService.registerMember(camporeeId, dto);
  }

  @Get(':camporeeId/members')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar miembros del camporee',
    description: 'Obtiene la lista de miembros registrados en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de miembros' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getMembers(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.getMembers(camporeeId);
  }

  @Delete(':camporeeId/members/:userId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Remover miembro del camporee',
    description: 'Desactiva el registro de un miembro en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Miembro removido' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async removeMember(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('userId') userId: string,
  ) {
    return this.camporeesService.removeMember(camporeeId, userId);
  }
}
