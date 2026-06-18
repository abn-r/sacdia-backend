import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthorizationResource, GlobalRoles } from '../common/decorators';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { CoordinationService } from './coordination.service';
import {
  CreateCoordinationZoneDto,
  CreateCoordinatorAssignmentDto,
  UpdateCoordinationZoneDto,
  UpdateCoordinatorAssignmentDto,
} from './dto';

type AuthenticatedRequest = Request & { user: { sub: string } };

@ApiTags('admin-coordination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@RequirePermissions('coordination:manage')
@AuthorizationResource({ type: 'global' })
@GlobalRoles(
  'admin',
  'super-admin',
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'director-dia',
  'assistant-dia',
)
@Controller('admin/coordination')
export class AdminCoordinationController {
  constructor(private readonly coordinationService: CoordinationService) {}

  @Get('local-fields/:localFieldId/zones')
  @ApiOperation({ summary: 'Listar zonas de coordinación de un campo local' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async listZones(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
  ) {
    const data = await this.coordinationService.listZones(
      req.user.sub,
      localFieldId,
    );
    return { status: 'success', data };
  }

  @Post('local-fields/:localFieldId/zones')
  @ApiOperation({ summary: 'Crear zona de coordinación en un campo local' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async createZone(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: CreateCoordinationZoneDto,
  ) {
    const data = await this.coordinationService.createZone(
      req.user.sub,
      localFieldId,
      dto,
    );
    return { status: 'success', data };
  }

  @Patch('zones/:zoneId')
  @ApiOperation({ summary: 'Actualizar zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  async updateZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateCoordinationZoneDto,
  ) {
    const data = await this.coordinationService.updateZone(
      req.user.sub,
      zoneId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('zones/:zoneId/districts/:districtId')
  @ApiOperation({ summary: 'Asignar un distrito a una zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  @ApiParam({ name: 'districtId', type: Number })
  async assignDistrictToZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Param('districtId', ParseIntPipe) districtId: number,
  ) {
    const data = await this.coordinationService.assignDistrictToZone(
      req.user.sub,
      zoneId,
      districtId,
    );
    return { status: 'success', data };
  }

  @Delete('zones/:zoneId/districts/:districtId')
  @ApiOperation({ summary: 'Quitar un distrito de una zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  @ApiParam({ name: 'districtId', type: Number })
  async removeDistrictFromZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Param('districtId', ParseIntPipe) districtId: number,
  ) {
    const data = await this.coordinationService.removeDistrictFromZone(
      req.user.sub,
      zoneId,
      districtId,
    );
    return { status: 'success', data };
  }

  @Get('local-fields/:localFieldId/assignments')
  @ApiOperation({ summary: 'Listar asignaciones de coordinadores' })
  @ApiParam({ name: 'localFieldId', type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  async listAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Query('active') active?: string,
  ) {
    const data = await this.coordinationService.listAssignments(
      req.user.sub,
      localFieldId,
      active === undefined ? undefined : active === 'true',
    );
    return { status: 'success', data };
  }

  @Post('local-fields/:localFieldId/assignments')
  @ApiOperation({ summary: 'Crear asignación de coordinador' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async createAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: CreateCoordinatorAssignmentDto,
  ) {
    const data = await this.coordinationService.createAssignment(
      req.user.sub,
      localFieldId,
      dto,
    );
    return { status: 'success', data };
  }

  @Patch('assignments/:assignmentId')
  @ApiOperation({ summary: 'Actualizar asignación de coordinador' })
  @ApiParam({ name: 'assignmentId', type: String })
  async updateAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateCoordinatorAssignmentDto,
  ) {
    const data = await this.coordinationService.updateAssignment(
      req.user.sub,
      assignmentId,
      dto,
    );
    return { status: 'success', data };
  }
}

@ApiTags('coordination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('coordination')
export class CoordinationController {
  constructor(private readonly coordinationService: CoordinationService) {}

  @Get('me/scope')
  @ApiOperation({
    summary: 'Resolver el alcance efectivo de coordinación del usuario actual',
  })
  async getMyCoordinatorScope(@Req() req: AuthenticatedRequest) {
    const data = await this.coordinationService.resolveCoordinatorScope(
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
