import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { maskEmail } from '../common/utils/mask-email.util';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';

type AssignRolePermissionOptions = {
  invalidateAffectedUsers?: boolean;
};

export type GlobalRoleWriteMeta = {
  correlationId: string;
  idempotencyKey: string;
};

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly globalUserRoleWrite: GlobalUserRoleWriteService,
  ) {}

  // ─── Permisos ───────────────────────────────────────────────

  async listPermissions() {
    // Small system table: permissions are defined at deploy time and are expected
    // to remain well under 500 rows. Safety cap prevents runaway reads.
    return this.prisma.permissions.findMany({
      orderBy: { permission_name: 'asc' },
      take: 500,
    });
  }

  async getPermissionById(id: string) {
    const permission = await this.prisma.permissions.findUnique({
      where: { permission_id: id },
    });

    if (!permission) {
      throw new AppNotFoundException(ErrorCode.RBAC_PERMISSION_NOT_FOUND, {
        id,
      });
    }

    return permission;
  }

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.prisma.permissions.findUnique({
      where: { permission_name: dto.permission_name },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.RBAC_PERMISSION_NAME_CONFLICT, {
        name: dto.permission_name,
      });
    }

    const permission = await this.prisma.permissions.create({
      data: {
        permission_name: dto.permission_name,
        description: dto.description ?? null,
      },
    });

    this.logger.log(`Permiso creado: ${permission.permission_name}`);
    return permission;
  }

  async updatePermission(id: string, dto: UpdatePermissionDto) {
    await this.getPermissionById(id);

    if (dto.permission_name) {
      const existing = await this.prisma.permissions.findFirst({
        where: {
          permission_name: dto.permission_name,
          NOT: { permission_id: id },
        },
      });

      if (existing) {
        throw new AppConflictException(
          ErrorCode.RBAC_PERMISSION_NAME_CONFLICT,
          { name: dto.permission_name },
        );
      }
    }

    const permission = await this.prisma.permissions.update({
      where: { permission_id: id },
      data: {
        ...(dto.permission_name !== undefined && {
          permission_name: dto.permission_name,
        }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.active !== undefined && { active: dto.active }),
        modified_at: new Date(),
      },
    });

    this.logger.log(`Permiso actualizado: ${permission.permission_name}`);
    return permission;
  }

  async deletePermission(id: string) {
    await this.getPermissionById(id);

    await this.prisma.permissions.update({
      where: { permission_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logger.log(`Permiso desactivado: ${id}`);
    return { success: true, message: 'Permiso desactivado' };
  }

  // ─── Roles ──────────────────────────────────────────────────

  async listRoles(activeFilter: boolean | undefined = true) {
    // Small system table: roles are defined at deploy time and are expected
    // to remain well under 200 rows. Safety cap prevents runaway reads.
    // activeFilter=true  → only active roles (default, existing behaviour)
    // activeFilter=false → only inactive roles
    // activeFilter=undefined → all roles (when caller passes 'all')
    const whereClause =
      activeFilter === undefined ? {} : { active: activeFilter };

    return this.prisma.roles.findMany({
      where: whereClause,
      orderBy: { role_name: 'asc' },
      include: {
        role_permissions: {
          where: { active: true },
          include: {
            permissions: {
              select: {
                permission_id: true,
                permission_name: true,
                description: true,
              },
            },
          },
        },
      },
      take: 200,
    });
  }

  // ─── Role CRUD (super-admin only) ───────────────────────────

  async createRole(dto: CreateRoleDto) {
    if (dto.role_name === 'super-admin') {
      throw new AppBadRequestException(ErrorCode.RBAC_ROLE_NAME_RESERVED, {
        name: dto.role_name,
      });
    }

    const existing = await this.prisma.roles.findUnique({
      where: { role_name: dto.role_name },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.RBAC_ROLE_NAME_CONFLICT, {
        name: dto.role_name,
      });
    }

    const permissionIds = dto.permission_ids ?? [];

    // Validate all provided permission IDs exist before opening transaction
    if (permissionIds.length > 0) {
      const permissions = await this.prisma.permissions.findMany({
        where: { permission_id: { in: permissionIds } },
        select: { permission_id: true },
      });

      if (permissions.length !== permissionIds.length) {
        const foundIds = new Set(permissions.map((p) => p.permission_id));
        const missing = permissionIds.filter((id) => !foundIds.has(id));
        throw new AppNotFoundException(ErrorCode.RBAC_PERMISSIONS_NOT_FOUND, {
          ids: missing.join(', '),
        });
      }
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roles.create({
        data: {
          role_name: dto.role_name,
          description: dto.description,
          role_category: dto.role_category,
        },
      });

      if (permissionIds.length > 0) {
        await tx.role_permissions.createMany({
          data: permissionIds.map((permissionId) => ({
            role_id: created.role_id,
            permission_id: permissionId,
          })),
        });
      }

      return tx.roles.findUnique({
        where: { role_id: created.role_id },
        include: {
          role_permissions: {
            where: { active: true },
            include: {
              permissions: {
                select: {
                  permission_id: true,
                  permission_name: true,
                  description: true,
                },
              },
            },
          },
        },
      });
    });

    this.logger.log(
      `Rol creado: ${role!.role_name} (${role!.role_id}) con ${permissionIds.length} permisos`,
    );

    return role;
  }

  async updateRole(roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: roleId,
      });
    }

    if (role.role_name === 'super-admin') {
      throw new AppForbiddenException(ErrorCode.RBAC_ROLE_PROTECTED);
    }

    // role_name is immutable — reject if caller sent it
    if ('role_name' in dto) {
      throw new AppBadRequestException(ErrorCode.RBAC_ROLE_NAME_IMMUTABLE);
    }

    const updateData: { description?: string; modified_at: Date } = {
      modified_at: new Date(),
    };

    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    // Update description and optionally sync permissions
    if (dto.permission_ids !== undefined) {
      // Run description update + permission sync in sequence
      if (Object.keys(updateData).length > 1) {
        await this.prisma.roles.update({
          where: { role_id: roleId },
          data: updateData,
        });
      }

      await this.syncRolePermissions(roleId, dto.permission_ids);
    } else {
      await this.prisma.roles.update({
        where: { role_id: roleId },
        data: updateData,
      });
    }

    const updated = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      include: {
        role_permissions: {
          where: { active: true },
          include: {
            permissions: {
              select: {
                permission_id: true,
                permission_name: true,
                description: true,
              },
            },
          },
        },
      },
    });

    this.logger.log(`Rol actualizado: ${updated!.role_name} (${roleId})`);
    return updated;
  }

  async deactivateRole(roleId: string) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: roleId,
      });
    }

    if (role.role_name === 'super-admin') {
      throw new AppForbiddenException(ErrorCode.RBAC_ROLE_PROTECTED);
    }

    // Count active user assignments for this role
    const assignedCount = await this.prisma.users_roles.count({
      where: { role_id: roleId, active: true },
    });

    if (assignedCount > 0) {
      throw new AppConflictException(ErrorCode.RBAC_ROLE_HAS_ASSIGNMENTS, {
        id: roleId,
        count: assignedCount,
      });
    }

    await this.prisma.roles.update({
      where: { role_id: roleId },
      data: { active: false, modified_at: new Date() },
    });

    this.logger.log(`Rol desactivado: ${role.role_name} (${roleId})`);
    return { success: true, role_id: roleId };
  }

  async getRoleWithPermissions(roleId: string) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      include: {
        role_permissions: {
          where: { active: true },
          include: {
            permissions: {
              select: {
                permission_id: true,
                permission_name: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: roleId,
      });
    }

    return role;
  }

  // ─── Asignación de permisos a roles ─────────────────────────

  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
    options: AssignRolePermissionOptions = {},
  ) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: roleId,
      });
    }

    // Verificar que todos los permisos existen
    const permissions = await this.prisma.permissions.findMany({
      where: { permission_id: { in: permissionIds } },
    });

    if (permissions.length !== permissionIds.length) {
      const foundIds = new Set(permissions.map((p) => p.permission_id));
      const missing = permissionIds.filter((id) => !foundIds.has(id));
      throw new AppNotFoundException(ErrorCode.RBAC_PERMISSIONS_NOT_FOUND, {
        ids: missing.join(', '),
      });
    }

    // Insertar solo los que no existan (upsert conceptual)
    const results = await Promise.all(
      permissionIds.map(async (permissionId) => {
        const existing = await this.prisma.role_permissions.findFirst({
          where: { role_id: roleId, permission_id: permissionId },
        });

        if (existing) {
          // Reactivar si estaba inactivo
          if (!existing.active) {
            await this.prisma.role_permissions.update({
              where: { role_permission_id: existing.role_permission_id },
              data: { active: true, modified_at: new Date() },
            });
            return 'reactivated';
          }
          return 'existing';
        }

        await this.prisma.role_permissions.create({
          data: { role_id: roleId, permission_id: permissionId },
        });
        return 'created';
      }),
    );

    const created = results.filter((r) => r === 'created').length;
    const reactivated = results.filter((r) => r === 'reactivated').length;

    if (
      (options.invalidateAffectedUsers ?? true) &&
      (created > 0 || reactivated > 0)
    ) {
      await this.invalidateAuthorizationCacheForRoleHolders(roleId);
    }

    this.logger.log(
      `Permisos asignados a rol ${role.role_name}: ${created} nuevos, ${reactivated} reactivados`,
    );

    return {
      success: true,
      message: `${created} permisos asignados, ${reactivated} reactivados`,
      created,
      reactivated,
    };
  }

  async removePermissionFromRole(roleId: string, permissionId: string) {
    const assignment = await this.prisma.role_permissions.findFirst({
      where: { role_id: roleId, permission_id: permissionId, active: true },
    });

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_PERMISSION_NOT_FOUND, {
        roleId,
        permissionId,
      });
    }

    await this.prisma.role_permissions.update({
      where: { role_permission_id: assignment.role_permission_id },
      data: { active: false, modified_at: new Date() },
    });

    await this.invalidateAuthorizationCacheForRoleHolders(roleId);

    this.logger.log(`Permiso ${permissionId} removido del rol ${roleId}`);

    return { success: true, message: 'Permiso removido del rol' };
  }

  // ─── Permisos directos de usuario ───────────────────────────

  async getUserPermissions(userId: string) {
    // Per-user direct permissions: bounded by the total number of permissions
    // in the system. Safety cap matches listPermissions.
    return this.prisma.users_permissions.findMany({
      where: { user_id: userId, active: true },
      include: {
        permissions: {
          select: {
            permission_id: true,
            permission_name: true,
            description: true,
            active: true,
          },
        },
      },
      orderBy: { permissions: { permission_name: 'asc' } },
      take: 500,
    });
  }

  async assignPermissionToUser(userId: string, permissionId: string) {
    const existing = await this.prisma.users_permissions.findFirst({
      where: { user_id: userId, permission_id: permissionId },
    });

    if (existing) {
      if (!existing.active) {
        await this.prisma.users_permissions.update({
          where: { user_permission_id: existing.user_permission_id },
          data: { active: true, modified_at: new Date() },
        });
        this.logger.log(
          `Permiso ${permissionId} reactivado para usuario ${userId}`,
        );
        return { success: true, message: 'Permiso reactivado' };
      }
      throw new AppConflictException(
        ErrorCode.RBAC_USER_PERMISSION_ALREADY_ASSIGNED,
        { userId, permissionId },
      );
    }

    await this.prisma.users_permissions.create({
      data: { user_id: userId, permission_id: permissionId },
    });

    this.logger.log(`Permiso ${permissionId} asignado a usuario ${userId}`);
    return { success: true, message: 'Permiso asignado' };
  }

  async removePermissionFromUser(userId: string, permissionId: string) {
    const assignment = await this.prisma.users_permissions.findFirst({
      where: { user_id: userId, permission_id: permissionId, active: true },
    });

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.RBAC_USER_PERMISSION_NOT_FOUND, {
        userId,
        permissionId,
      });
    }

    await this.prisma.users_permissions.update({
      where: { user_permission_id: assignment.user_permission_id },
      data: { active: false, modified_at: new Date() },
    });

    this.logger.log(`Permiso ${permissionId} removido del usuario ${userId}`);
    return { success: true, message: 'Permiso removido del usuario' };
  }

  // ─── Roles de usuario ──────────────────────────────────────

  async getUserRoles(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.RBAC_USER_NOT_FOUND, {
        id: userId,
      });
    }

    // Per-user role assignments: bounded by the total number of roles.
    // Safety cap matches listRoles.
    return this.prisma.users_roles.findMany({
      where: { user_id: userId, active: true },
      include: {
        roles: {
          select: {
            role_id: true,
            role_name: true,
            role_category: true,
            active: true,
          },
        },
      },
      orderBy: { roles: { role_name: 'asc' } },
      take: 200,
    });
  }

  async assignRoleToUser(
    userId: string,
    roleId: string,
    actorUserId: string,
    meta: GlobalRoleWriteMeta,
  ) {
    const result = await this.globalUserRoleWrite.assign({
      actorUserId,
      targetUserId: userId,
      roleId,
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
    });
    if (result.changed) {
      await this.authorizationContext.invalidateUserAuthorizationCache(userId);
    }
    return {
      success: true as const,
      message: result.changed ? 'Rol asignado' : 'Asignación sin cambios',
      ...result,
    };
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    actorUserId: string,
    meta: GlobalRoleWriteMeta,
  ) {
    const result = await this.globalUserRoleWrite.revoke({
      actorUserId,
      targetUserId: userId,
      roleId,
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
    });
    if (result.changed) {
      await this.authorizationContext.invalidateUserAuthorizationCache(userId);
    }
    return {
      success: true as const,
      message: result.changed
        ? 'Rol removido del usuario'
        : 'Revocación sin cambios',
      ...result,
    };
  }

  async bootstrapAdmin(userId: string) {
    // Check if any super-admin already exists
    const existingSuperAdmin = await this.prisma.users_roles.findFirst({
      where: {
        active: true,
        roles: {
          role_name: 'super-admin',
          active: true,
        },
      },
    });

    if (existingSuperAdmin) {
      throw new AppConflictException(ErrorCode.RBAC_SUPER_ADMIN_ALREADY_EXISTS);
    }

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true, email: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.RBAC_USER_NOT_FOUND, {
        id: userId,
      });
    }

    const superAdminRole = await this.prisma.roles.findFirst({
      where: { role_name: 'super-admin', active: true },
    });

    if (!superAdminRole) {
      throw new AppNotFoundException(ErrorCode.RBAC_SUPER_ADMIN_ROLE_NOT_FOUND);
    }

    await this.prisma.users_roles.create({
      data: {
        user_id: userId,
        role_id: superAdminRole.role_id,
      },
    });

    this.logger.warn(
      `BOOTSTRAP: Usuario ${maskEmail(user.email)} (${userId}) asignado como primer super-admin`,
    );

    await this.authorizationContext.invalidateUserAuthorizationCache(userId);

    return {
      success: true,
      message: `Usuario ${user.email} es ahora super-admin`,
      user_id: userId,
      role: 'super-admin',
    };
  }

  async syncRolePermissions(roleId: string, permissionIds: string[]) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: roleId,
      });
    }

    // Obtener asignaciones actuales activas
    const current = await this.prisma.role_permissions.findMany({
      where: { role_id: roleId, active: true },
    });

    const currentIds = new Set(current.map((rp) => rp.permission_id));
    const desiredIds = new Set(permissionIds);

    // Permisos a remover (están activos pero no en la lista deseada)
    const toRemove = current.filter((rp) => !desiredIds.has(rp.permission_id));

    // Permisos a agregar (están en la lista deseada pero no activos)
    const toAdd = permissionIds.filter((id) => !currentIds.has(id));

    // Desactivar los que sobran
    if (toRemove.length > 0) {
      await this.prisma.role_permissions.updateMany({
        where: {
          role_permission_id: {
            in: toRemove.map((rp) => rp.role_permission_id),
          },
        },
        data: { active: false, modified_at: new Date() },
      });
    }

    // Agregar los nuevos (o reactivar)
    if (toAdd.length > 0) {
      await this.assignPermissionsToRole(roleId, toAdd, {
        invalidateAffectedUsers: false,
      });
    }

    if (toRemove.length > 0 || toAdd.length > 0) {
      await this.invalidateAuthorizationCacheForRoleHolders(roleId);
    }

    this.logger.log(
      `Permisos sincronizados para rol ${role.role_name}: +${toAdd.length} -${toRemove.length}`,
    );

    return {
      success: true,
      added: toAdd.length,
      removed: toRemove.length,
    };
  }

  private async invalidateAuthorizationCacheForRoleHolders(
    roleId: string,
  ): Promise<void> {
    const [globalAssignments, clubAssignments] = await Promise.all([
      this.prisma.users_roles.findMany({
        where: { role_id: roleId, active: true },
        select: { user_id: true },
      }),
      this.prisma.club_role_assignments.findMany({
        where: { role_id: roleId, active: true },
        select: { user_id: true },
      }),
    ]);

    const userIds = new Set<string>();
    for (const assignment of globalAssignments) {
      userIds.add(assignment.user_id);
    }
    for (const assignment of clubAssignments) {
      userIds.add(assignment.user_id);
    }

    await Promise.all(
      Array.from(userIds).map((userId) =>
        this.authorizationContext.invalidateUserAuthorizationCache(userId),
      ),
    );

    if (userIds.size > 0) {
      this.logger.debug(
        `Auth context cache invalidado para ${userIds.size} usuario(s) por cambio de permisos del rol ${roleId}`,
      );
    }
  }
}
