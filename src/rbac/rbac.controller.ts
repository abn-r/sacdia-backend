import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { RbacService } from './rbac.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';

@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  // ─── Permisos CRUD ──────────────────────────────────────────

  @Get('permissions')
  @RequirePermissions('permissions:read')
  @ApiOperation({ summary: 'Listar todos los permisos' })
  @ApiResponse({ status: 200, description: 'Lista de permisos' })
  async listPermissions() {
    const data = await this.rbacService.listPermissions();
    return { status: 'success', data };
  }

  @Get('permissions/:id')
  @RequirePermissions('permissions:read')
  @ApiOperation({ summary: 'Obtener un permiso por ID' })
  @ApiResponse({ status: 200, description: 'Detalle del permiso' })
  async getPermission(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.rbacService.getPermissionById(id);
    return { status: 'success', data };
  }

  @Post('permissions')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Crear un nuevo permiso' })
  @ApiResponse({ status: 201, description: 'Permiso creado' })
  async createPermission(@Body() dto: CreatePermissionDto) {
    const data = await this.rbacService.createPermission(dto);
    return { status: 'success', data };
  }

  @Patch('permissions/:id')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Actualizar un permiso' })
  @ApiResponse({ status: 200, description: 'Permiso actualizado' })
  async updatePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
  ) {
    const data = await this.rbacService.updatePermission(id, dto);
    return { status: 'success', data };
  }

  @Delete('permissions/:id')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Desactivar un permiso' })
  @ApiResponse({ status: 200, description: 'Permiso desactivado' })
  async deletePermission(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbacService.deletePermission(id);
  }

  // ─── Roles ──────────────────────────────────────────────────

  @Get('roles')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Listar roles con sus permisos' })
  @ApiResponse({ status: 200, description: 'Lista de roles con permisos' })
  async listRoles() {
    const data = await this.rbacService.listRoles();
    return { status: 'success', data };
  }

  @Get('roles/:id')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Obtener rol con sus permisos' })
  @ApiResponse({ status: 200, description: 'Rol con permisos' })
  async getRole(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.rbacService.getRoleWithPermissions(id);
    return { status: 'success', data };
  }

  // ─── Asignación de permisos a roles ─────────────────────────

  @Post('roles/:id/permissions')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  @ApiResponse({ status: 200, description: 'Permisos asignados' })
  async assignPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.assignPermissionsToRole(id, dto.permission_ids);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Sincronizar permisos de un rol (reemplaza todos)' })
  @ApiResponse({ status: 200, description: 'Permisos sincronizados' })
  async syncPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.syncRolePermissions(id, dto.permission_ids);
  }

  @Delete('roles/:id/permissions/:permissionId')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Remover un permiso de un rol' })
  @ApiResponse({ status: 200, description: 'Permiso removido del rol' })
  async removePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.rbacService.removePermissionFromRole(id, permissionId);
  }
}
