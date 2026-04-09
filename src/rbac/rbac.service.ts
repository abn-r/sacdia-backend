import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { maskEmail } from '../common/utils/mask-email.util';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
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
      throw new NotFoundException(`Permiso ${id} no encontrado`);
    }

    return permission;
  }

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.prisma.permissions.findUnique({
      where: { permission_name: dto.permission_name },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe un permiso con nombre "${dto.permission_name}"`,
      );
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
        throw new ConflictException(
          `Ya existe un permiso con nombre "${dto.permission_name}"`,
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

  async listRoles() {
    // Small system table: roles are defined at deploy time and are expected
    // to remain well under 200 rows. Safety cap prevents runaway reads.
    return this.prisma.roles.findMany({
      where: { active: true },
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
      throw new NotFoundException(`Rol ${roleId} no encontrado`);
    }

    return role;
  }

  // ─── Asignación de permisos a roles ─────────────────────────

  async assignPermissionsToRole(roleId: string, permissionIds: string[]) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Rol ${roleId} no encontrado`);
    }

    // Verificar que todos los permisos existen
    const permissions = await this.prisma.permissions.findMany({
      where: { permission_id: { in: permissionIds } },
    });

    if (permissions.length !== permissionIds.length) {
      const foundIds = new Set(permissions.map((p) => p.permission_id));
      const missing = permissionIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Permisos no encontrados: ${missing.join(', ')}`,
      );
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
      throw new NotFoundException('Asignación de permiso a rol no encontrada');
    }

    await this.prisma.role_permissions.update({
      where: { role_permission_id: assignment.role_permission_id },
      data: { active: false, modified_at: new Date() },
    });

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
      throw new ConflictException('El usuario ya tiene este permiso asignado');
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
      throw new NotFoundException(
        'Asignación de permiso a usuario no encontrada',
      );
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
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
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

  async assignRoleToUser(userId: string, roleId: string) {
    const [user, role] = await Promise.all([
      this.prisma.users.findUnique({
        where: { user_id: userId },
        select: { user_id: true },
      }),
      this.prisma.roles.findUnique({
        where: { role_id: roleId },
        select: { role_id: true, role_name: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }

    if (!role) {
      throw new NotFoundException(`Rol ${roleId} no encontrado`);
    }

    const existing = await this.prisma.users_roles.findFirst({
      where: { user_id: userId, role_id: roleId },
    });

    if (existing) {
      if (!existing.active) {
        await this.prisma.users_roles.update({
          where: { user_role_id: existing.user_role_id },
          data: { active: true, modified_at: new Date() },
        });
        this.logger.log(
          `Rol ${role.role_name} reactivado para usuario ${userId}`,
        );
        await this.authorizationContext.invalidateUserAuthorizationCache(
          userId,
        );
        return { success: true, message: 'Rol reactivado' };
      }
      throw new ConflictException('El usuario ya tiene este rol asignado');
    }

    await this.prisma.users_roles.create({
      data: { user_id: userId, role_id: roleId },
    });

    this.logger.log(`Rol ${role.role_name} asignado a usuario ${userId}`);
    await this.authorizationContext.invalidateUserAuthorizationCache(userId);
    return { success: true, message: 'Rol asignado' };
  }

  async removeRoleFromUser(userId: string, roleId: string) {
    const assignment = await this.prisma.users_roles.findFirst({
      where: { user_id: userId, role_id: roleId, active: true },
    });

    if (!assignment) {
      throw new NotFoundException('Asignación de rol a usuario no encontrada');
    }

    await this.prisma.users_roles.update({
      where: { user_role_id: assignment.user_role_id },
      data: { active: false, modified_at: new Date() },
    });

    this.logger.log(`Rol ${roleId} removido del usuario ${userId}`);
    await this.authorizationContext.invalidateUserAuthorizationCache(userId);
    return { success: true, message: 'Rol removido del usuario' };
  }

  async bootstrapAdmin(userId: string) {
    // Check if any super_admin already exists
    const existingSuperAdmin = await this.prisma.users_roles.findFirst({
      where: {
        active: true,
        roles: {
          role_name: 'super_admin',
          active: true,
        },
      },
    });

    if (existingSuperAdmin) {
      throw new ConflictException(
        'Ya existe un super_admin. Este endpoint solo funciona cuando no hay ninguno.',
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }

    const superAdminRole = await this.prisma.roles.findFirst({
      where: { role_name: 'super_admin', active: true },
    });

    if (!superAdminRole) {
      throw new NotFoundException(
        'Rol super_admin no encontrado en la base de datos. Ejecutá el seed primero.',
      );
    }

    await this.prisma.users_roles.create({
      data: {
        user_id: userId,
        role_id: superAdminRole.role_id,
      },
    });

    this.logger.warn(
      `BOOTSTRAP: Usuario ${maskEmail(user.email)} (${userId}) asignado como primer super_admin`,
    );

    await this.authorizationContext.invalidateUserAuthorizationCache(userId);

    return {
      success: true,
      message: `Usuario ${user.email} es ahora super_admin`,
      user_id: userId,
      role: 'super_admin',
    };
  }

  async syncRolePermissions(roleId: string, permissionIds: string[]) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Rol ${roleId} no encontrado`);
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
      await this.assignPermissionsToRole(roleId, toAdd);
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
}
