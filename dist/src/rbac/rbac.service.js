"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RbacService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let RbacService = RbacService_1 = class RbacService {
    prisma;
    logger = new common_1.Logger(RbacService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listPermissions() {
        return this.prisma.permissions.findMany({
            orderBy: { permission_name: 'asc' },
        });
    }
    async getPermissionById(id) {
        const permission = await this.prisma.permissions.findUnique({
            where: { permission_id: id },
        });
        if (!permission) {
            throw new common_1.NotFoundException(`Permiso ${id} no encontrado`);
        }
        return permission;
    }
    async createPermission(dto) {
        const existing = await this.prisma.permissions.findUnique({
            where: { permission_name: dto.permission_name },
        });
        if (existing) {
            throw new common_1.ConflictException(`Ya existe un permiso con nombre "${dto.permission_name}"`);
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
    async updatePermission(id, dto) {
        await this.getPermissionById(id);
        if (dto.permission_name) {
            const existing = await this.prisma.permissions.findFirst({
                where: {
                    permission_name: dto.permission_name,
                    NOT: { permission_id: id },
                },
            });
            if (existing) {
                throw new common_1.ConflictException(`Ya existe un permiso con nombre "${dto.permission_name}"`);
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
    async deletePermission(id) {
        await this.getPermissionById(id);
        await this.prisma.permissions.update({
            where: { permission_id: id },
            data: { active: false, modified_at: new Date() },
        });
        this.logger.log(`Permiso desactivado: ${id}`);
        return { success: true, message: 'Permiso desactivado' };
    }
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
    async getRoleWithPermissions(roleId) {
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
            throw new common_1.NotFoundException(`Rol ${roleId} no encontrado`);
        }
        return role;
    }
    async assignPermissionsToRole(roleId, permissionIds) {
        const role = await this.prisma.roles.findUnique({
            where: { role_id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException(`Rol ${roleId} no encontrado`);
        }
        const permissions = await this.prisma.permissions.findMany({
            where: { permission_id: { in: permissionIds } },
        });
        if (permissions.length !== permissionIds.length) {
            const foundIds = new Set(permissions.map((p) => p.permission_id));
            const missing = permissionIds.filter((id) => !foundIds.has(id));
            throw new common_1.NotFoundException(`Permisos no encontrados: ${missing.join(', ')}`);
        }
        const results = await Promise.all(permissionIds.map(async (permissionId) => {
            const existing = await this.prisma.role_permissions.findFirst({
                where: { role_id: roleId, permission_id: permissionId },
            });
            if (existing) {
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
        }));
        const created = results.filter((r) => r === 'created').length;
        const reactivated = results.filter((r) => r === 'reactivated').length;
        this.logger.log(`Permisos asignados a rol ${role.role_name}: ${created} nuevos, ${reactivated} reactivados`);
        return {
            success: true,
            message: `${created} permisos asignados, ${reactivated} reactivados`,
            created,
            reactivated,
        };
    }
    async removePermissionFromRole(roleId, permissionId) {
        const assignment = await this.prisma.role_permissions.findFirst({
            where: { role_id: roleId, permission_id: permissionId, active: true },
        });
        if (!assignment) {
            throw new common_1.NotFoundException('Asignación de permiso a rol no encontrada');
        }
        await this.prisma.role_permissions.update({
            where: { role_permission_id: assignment.role_permission_id },
            data: { active: false, modified_at: new Date() },
        });
        this.logger.log(`Permiso ${permissionId} removido del rol ${roleId}`);
        return { success: true, message: 'Permiso removido del rol' };
    }
    async syncRolePermissions(roleId, permissionIds) {
        const role = await this.prisma.roles.findUnique({
            where: { role_id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException(`Rol ${roleId} no encontrado`);
        }
        const current = await this.prisma.role_permissions.findMany({
            where: { role_id: roleId, active: true },
        });
        const currentIds = new Set(current.map((rp) => rp.permission_id));
        const desiredIds = new Set(permissionIds);
        const toRemove = current.filter((rp) => !desiredIds.has(rp.permission_id));
        const toAdd = permissionIds.filter((id) => !currentIds.has(id));
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
        if (toAdd.length > 0) {
            await this.assignPermissionsToRole(roleId, toAdd);
        }
        this.logger.log(`Permisos sincronizados para rol ${role.role_name}: +${toAdd.length} -${toRemove.length}`);
        return {
            success: true,
            added: toAdd.length,
            removed: toRemove.length,
        };
    }
};
exports.RbacService = RbacService;
exports.RbacService = RbacService = RbacService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RbacService);
//# sourceMappingURL=rbac.service.js.map