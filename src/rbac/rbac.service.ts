import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Permisos ───────────────────────────────────────────────

  async listPermissions() {
    return this.prisma.permissions.findMany({
      orderBy: { permission_name: 'asc' },
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
      throw new ConflictException(
        'El usuario ya tiene este permiso asignado',
      );
    }

    await this.prisma.users_permissions.create({
      data: { user_id: userId, permission_id: permissionId },
    });

    this.logger.log(
      `Permiso ${permissionId} asignado a usuario ${userId}`,
    );
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

    this.logger.log(
      `Permiso ${permissionId} removido del usuario ${userId}`,
    );
    return { success: true, message: 'Permiso removido del usuario' };
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
