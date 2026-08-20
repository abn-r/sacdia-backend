import { timingSafeEqual } from 'crypto';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Put,
  Headers,
} from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { namedThrottle } from '../config/throttler.helpers';
import {
  AuthorizationResource,
  RequirePermissions,
  GlobalRoles,
  CurrentUser,
  Public,
} from '../common/decorators';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';
import { RbacService } from './rbac.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
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
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Crear un nuevo permiso' })
  @ApiResponse({ status: 201, description: 'Permiso creado' })
  async createPermission(@Body() dto: CreatePermissionDto) {
    const data = await this.rbacService.createPermission(dto);
    return { status: 'success', data };
  }

  @Patch('permissions/:id')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
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
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
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
  @ApiQuery({
    name: 'active',
    required: false,
    enum: ['true', 'false', 'all'],
    description: 'Filtrar por estado: true (default), false, all',
  })
  @ApiResponse({ status: 200, description: 'Lista de roles con permisos' })
  async listRoles(@Query('active') active?: string) {
    let activeFilter: boolean | undefined = true;
    if (active === 'false') activeFilter = false;
    else if (active === 'all') activeFilter = undefined;

    const data = await this.rbacService.listRoles(activeFilter);
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

  // ─── Role CRUD (super-admin only) ───────────────────────────

  @Post('roles')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Crear un nuevo rol' })
  @ApiResponse({ status: 201, description: 'Rol creado con sus permisos' })
  @ApiResponse({ status: 400, description: 'Nombre inválido o reservado' })
  @ApiResponse({ status: 404, description: 'Algún permission_id no existe' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con ese nombre' })
  async createRole(@Body() dto: CreateRoleDto) {
    const data = await this.rbacService.createRole(dto);
    return { status: 'success', data };
  }

  @Patch('roles/:id')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Actualizar descripción y/o permisos de un rol' })
  @ApiResponse({ status: 200, description: 'Rol actualizado' })
  @ApiResponse({
    status: 400,
    description: 'role_name inmutable o body inválido',
  })
  @ApiResponse({ status: 403, description: 'El rol super-admin es protegido' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const data = await this.rbacService.updateRole(id, dto);
    return { status: 'success', data };
  }

  @Delete('roles/:id')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Desactivar (soft delete) un rol' })
  @ApiResponse({
    status: 200,
    description: 'Rol desactivado: { success: true, role_id }',
  })
  @ApiResponse({ status: 403, description: 'El rol super-admin es protegido' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El rol tiene usuarios asignados activos',
  })
  async deactivateRole(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.rbacService.deactivateRole(id);
    return { status: 'success', data };
  }

  // ─── Asignación de permisos a roles ─────────────────────────

  @Post('roles/:id/permissions')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  @ApiResponse({ status: 200, description: 'Permisos asignados' })
  async assignPermissions(
    @CurrentUser() actor: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.assignPermissionsToRole(id, dto.permission_ids, {
      actorUserId: actor.userId,
    });
  }

  @Put('roles/:id/permissions')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Sincronizar permisos de un rol (reemplaza todos)' })
  @ApiResponse({ status: 200, description: 'Permisos sincronizados' })
  async syncPermissions(
    @CurrentUser() actor: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.syncRolePermissions(
      id,
      dto.permission_ids,
      actor.userId,
    );
  }

  @Delete('roles/:id/permissions/:permissionId')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Remover un permiso de un rol' })
  @ApiResponse({ status: 200, description: 'Permiso removido del rol' })
  async removePermission(
    @CurrentUser() actor: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.rbacService.removePermissionFromRole(
      id,
      permissionId,
      actor.userId,
    );
  }

  // ─── Permisos directos de usuario ───────────────────────────

  @Get('users/:userId/permissions')
  @RequirePermissions('permissions:read')
  @ApiOperation({ summary: 'Listar permisos directos de un usuario' })
  @ApiResponse({ status: 200, description: 'Permisos directos del usuario' })
  async getUserPermissions(@Param('userId', ParseUUIDPipe) userId: string) {
    const data = await this.rbacService.getUserPermissions(userId);
    return { status: 'success', data };
  }

  @Post('users/:userId/permissions')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Asignar un permiso directo a un usuario' })
  @ApiResponse({ status: 200, description: 'Permiso asignado al usuario' })
  async assignPermissionToUser(
    @CurrentUser() actor: { userId: string },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    const permissionId = dto.permission_ids[0];
    return this.rbacService.assignPermissionToUser(
      userId,
      permissionId,
      actor.userId,
    );
  }

  @Delete('users/:userId/permissions/:permissionId')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Remover un permiso directo de un usuario' })
  @ApiResponse({ status: 200, description: 'Permiso removido del usuario' })
  async removePermissionFromUser(
    @CurrentUser() actor: { userId: string },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.rbacService.removePermissionFromUser(
      userId,
      permissionId,
      actor.userId,
    );
  }

  // ─── Roles de usuario ─────────────────────────────────────

  @Get('users/:userId/roles')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'super-admin')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Listar roles asignados a un usuario' })
  @ApiResponse({ status: 200, description: 'Lista de roles del usuario' })
  async getUserRoles(@Param('userId', ParseUUIDPipe) userId: string) {
    const data = await this.rbacService.getUserRoles(userId);
    return { status: 'success', data };
  }

  @Post('users/:userId/roles')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Asignar un rol a un usuario' })
  @ApiResponse({ status: 201, description: 'Rol asignado al usuario' })
  async assignRoleToUser(
    @CurrentUser() actor: { userId: string },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.rbacService.assignRoleToUser(userId, dto.role_id, actor.userId);
  }

  @Delete('users/:userId/roles/:roleId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'super-admin')
  @RequirePermissions('permissions:assign')
  @ApiOperation({ summary: 'Remover un rol de un usuario' })
  @ApiResponse({ status: 200, description: 'Rol removido del usuario' })
  async removeRoleFromUser(
    @CurrentUser() actor: { userId: string },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.rbacService.removeRoleFromUser(userId, roleId, actor.userId);
  }
}

// ─── Bootstrap Controller ───────────────────────────────────
// Requiere x-bootstrap-secret header que coincida con BOOTSTRAP_SECRET env var.
// Si BOOTSTRAP_SECRET no está configurado, el endpoint retorna 403 (deshabilitado).

@ApiTags('rbac-bootstrap')
@Controller('admin/rbac')
export class RbacBootstrapController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly configService: ConfigService,
  ) {}

  // Público a propósito: protegido por x-bootstrap-secret y solo funciona
  // mientras no exista ningún super-admin.
  @Public()
  @Post('bootstrap-admin')
  // Rate limit estricto: 1 request por minuto (protección contra race condition en deploy)
  @Throttle(namedThrottle({ ttl: 60000, limit: 1 }))
  @ApiOperation({
    summary: 'Crear el primer super-admin (solo funciona si no existe ninguno)',
    description:
      'Requiere el header x-bootstrap-secret con el valor de BOOTSTRAP_SECRET. ' +
      'Si BOOTSTRAP_SECRET no está configurado, el endpoint está deshabilitado.',
  })
  @ApiHeader({
    name: 'x-bootstrap-secret',
    description: 'Secret de bootstrap definido en BOOTSTRAP_SECRET (env var)',
    required: true,
  })
  @ApiResponse({ status: 201, description: 'Primer super-admin creado' })
  @ApiResponse({
    status: 403,
    description:
      'Endpoint deshabilitado (BOOTSTRAP_SECRET no configurado) o secret inválido',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un super-admin',
  })
  async bootstrapAdmin(
    @Headers('x-bootstrap-secret') bootstrapSecret: string | undefined,
    @Body() dto: BootstrapAdminDto,
  ) {
    const configuredSecret = this.configService.get<string>('BOOTSTRAP_SECRET');

    if (!configuredSecret) {
      throw new AppForbiddenException(ErrorCode.RBAC_BOOTSTRAP_FORBIDDEN);
    }

    if (!bootstrapSecret) {
      throw new AppForbiddenException(ErrorCode.RBAC_BOOTSTRAP_SECRET_INVALID);
    }

    const secretBuffer = Buffer.from(configuredSecret, 'utf8');
    const providedBuffer = Buffer.from(bootstrapSecret, 'utf8');

    if (
      secretBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(secretBuffer, providedBuffer)
    ) {
      throw new AppForbiddenException(ErrorCode.RBAC_BOOTSTRAP_SECRET_INVALID);
    }

    return this.rbacService.bootstrapAdmin(dto.user_id);
  }
}
