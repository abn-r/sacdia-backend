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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const global_roles_guard_1 = require("../common/guards/global-roles.guard");
const global_roles_decorator_1 = require("../common/decorators/global-roles.decorator");
const rbac_service_1 = require("./rbac.service");
const create_permission_dto_1 = require("./dto/create-permission.dto");
const update_permission_dto_1 = require("./dto/update-permission.dto");
const assign_permissions_dto_1 = require("./dto/assign-permissions.dto");
let RbacController = class RbacController {
    rbacService;
    constructor(rbacService) {
        this.rbacService = rbacService;
    }
    async listPermissions() {
        const data = await this.rbacService.listPermissions();
        return { status: 'success', data };
    }
    async getPermission(id) {
        const data = await this.rbacService.getPermissionById(id);
        return { status: 'success', data };
    }
    async createPermission(dto) {
        const data = await this.rbacService.createPermission(dto);
        return { status: 'success', data };
    }
    async updatePermission(id, dto) {
        const data = await this.rbacService.updatePermission(id, dto);
        return { status: 'success', data };
    }
    async deletePermission(id) {
        return this.rbacService.deletePermission(id);
    }
    async listRoles() {
        const data = await this.rbacService.listRoles();
        return { status: 'success', data };
    }
    async getRole(id) {
        const data = await this.rbacService.getRoleWithPermissions(id);
        return { status: 'success', data };
    }
    async assignPermissions(id, dto) {
        return this.rbacService.assignPermissionsToRole(id, dto.permission_ids);
    }
    async syncPermissions(id, dto) {
        return this.rbacService.syncRolePermissions(id, dto.permission_ids);
    }
    async removePermission(id, permissionId) {
        return this.rbacService.removePermissionFromRole(id, permissionId);
    }
};
exports.RbacController = RbacController;
__decorate([
    (0, common_1.Get)('permissions'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Listar todos los permisos' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista de permisos' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "listPermissions", null);
__decorate([
    (0, common_1.Get)('permissions/:id'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener un permiso por ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Detalle del permiso' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getPermission", null);
__decorate([
    (0, common_1.Post)('permissions'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Crear un nuevo permiso' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Permiso creado' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_permission_dto_1.CreatePermissionDto]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "createPermission", null);
__decorate([
    (0, common_1.Patch)('permissions/:id'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar un permiso' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso actualizado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_permission_dto_1.UpdatePermissionDto]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "updatePermission", null);
__decorate([
    (0, common_1.Delete)('permissions/:id'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Desactivar un permiso' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso desactivado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "deletePermission", null);
__decorate([
    (0, common_1.Get)('roles'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Listar roles con sus permisos' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista de roles con permisos' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "listRoles", null);
__decorate([
    (0, common_1.Get)('roles/:id'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener rol con sus permisos' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rol con permisos' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getRole", null);
__decorate([
    (0, common_1.Post)('roles/:id/permissions'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Asignar permisos a un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permisos asignados' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assign_permissions_dto_1.AssignPermissionsDto]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "assignPermissions", null);
__decorate([
    (0, common_1.Put)('roles/:id/permissions'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Sincronizar permisos de un rol (reemplaza todos)' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permisos sincronizados' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assign_permissions_dto_1.AssignPermissionsDto]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "syncPermissions", null);
__decorate([
    (0, common_1.Delete)('roles/:id/permissions/:permissionId'),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Remover un permiso de un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso removido del rol' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Param)('permissionId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "removePermission", null);
exports.RbacController = RbacController = __decorate([
    (0, swagger_1.ApiTags)('rbac'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, global_roles_guard_1.GlobalRolesGuard),
    (0, common_1.Controller)('admin/rbac'),
    __metadata("design:paramtypes", [rbac_service_1.RbacService])
], RbacController);
//# sourceMappingURL=rbac.controller.js.map