import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
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
} from '@nestjs/swagger';
import { UnitsService } from './units.service';
import {
  CreateUnitDto,
  UpdateUnitDto,
  AddUnitMemberDto,
  CreateWeeklyRecordDto,
  UpdateWeeklyRecordDto,
} from './dto';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';

@ApiTags('units')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  // ========================================
  // UNIDADES POR CLUB
  // ========================================

  @Get('clubs/:clubId/units')
  @RequirePermissions('units:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Listar unidades del club' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de unidades' })
  @ApiResponse({ status: 404, description: 'Club no encontrado' })
  async findByClub(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.unitsService.findByClub(clubId);
  }

  @Post('clubs/:clubId/units')
  @RequirePermissions('units:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Crear unidad en el club' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Unidad creada' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  @ApiResponse({ status: 404, description: 'Club no encontrado' })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateUnitDto,
  ) {
    return this.unitsService.create(clubId, dto);
  }

  @Get('clubs/:clubId/units/:unitId')
  @RequirePermissions('units:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener detalle de una unidad con miembros' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 200, description: 'Unidad encontrada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async findOne(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
  ) {
    return this.unitsService.findOne(unitId);
  }

  @Patch('clubs/:clubId/units/:unitId')
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Actualizar unidad' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 200, description: 'Unidad actualizada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async update(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.unitsService.update(unitId, dto);
  }

  @Delete('clubs/:clubId/units/:unitId')
  @RequirePermissions('units:delete')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Desactivar unidad (soft delete)' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 200, description: 'Unidad desactivada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async remove(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
  ) {
    return this.unitsService.remove(unitId);
  }

  // ========================================
  // MIEMBROS
  // ========================================

  @Post('clubs/:clubId/units/:unitId/members')
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Agregar miembro a la unidad' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 201, description: 'Miembro agregado' })
  @ApiResponse({ status: 404, description: 'Unidad o usuario no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El usuario ya es miembro de una unidad',
  })
  async addMember(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
    @Body() dto: AddUnitMemberDto,
  ) {
    return this.unitsService.addMember(unitId, dto);
  }

  @Delete('clubs/:clubId/units/:unitId/members/:memberId')
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Remover miembro de la unidad (soft delete)' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiParam({ name: 'memberId', type: Number })
  @ApiResponse({ status: 200, description: 'Miembro removido' })
  @ApiResponse({
    status: 404,
    description: 'Miembro no encontrado en la unidad',
  })
  async removeMember(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return this.unitsService.removeMember(unitId, memberId);
  }

  // ========================================
  // REGISTROS SEMANALES
  // ========================================

  @Get('clubs/:clubId/units/:unitId/weekly-records')
  @RequirePermissions('units:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar registros semanales de la unidad',
    description:
      'Devuelve los registros semanales de todos los miembros activos de la unidad',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de registros semanales' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async findWeeklyRecords(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
  ) {
    return this.unitsService.findWeeklyRecords(unitId);
  }

  @Post('clubs/:clubId/units/:unitId/weekly-records')
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Crear registro semanal' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiResponse({ status: 201, description: 'Registro semanal creado' })
  @ApiResponse({
    status: 400,
    description: 'El usuario no es miembro activo de la unidad',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un registro para esa semana',
  })
  async createWeeklyRecord(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
    @Body() dto: CreateWeeklyRecordDto,
    @Request() req: any,
  ) {
    return this.unitsService.createWeeklyRecord(unitId, dto, req.user.sub);
  }

  @Patch('clubs/:clubId/units/:unitId/weekly-records/:recordId')
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Actualizar registro semanal' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'unitId', type: Number })
  @ApiParam({ name: 'recordId', type: Number })
  @ApiResponse({ status: 200, description: 'Registro actualizado' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async updateWeeklyRecord(
    @Param('clubId', ParseIntPipe) _clubId: number,
    @Param('unitId', ParseIntPipe) unitId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: UpdateWeeklyRecordDto,
  ) {
    return this.unitsService.updateWeeklyRecord(unitId, recordId, dto);
  }
}
