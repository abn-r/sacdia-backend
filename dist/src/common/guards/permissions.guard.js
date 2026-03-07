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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_service_1 = require("../../prisma/prisma.service");
const authorization_context_service_1 = require("../services/authorization-context.service");
const authorization_resource_decorator_1 = require("../decorators/authorization-resource.decorator");
const permissions_decorator_1 = require("../decorators/permissions.decorator");
let PermissionsGuard = class PermissionsGuard {
    reflector;
    authorizationContext;
    prisma;
    constructor(reflector, authorizationContext, prisma) {
        this.reflector = reflector;
        this.authorizationContext = authorizationContext;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const requirement = this.reflector.getAllAndOverride(permissions_decorator_1.PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
        if (!requirement || requirement.permissions.length === 0) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.sub;
        if (!userId) {
            throw new common_1.ForbiddenException('User not authenticated');
        }
        const resource = this.reflector.getAllAndOverride(authorization_resource_decorator_1.AUTHORIZATION_RESOURCE_KEY, [context.getHandler(), context.getClass()]) ?? { type: 'global' };
        if (resource.type === 'user' && this.isResourceOwner(request, userId, resource)) {
            return true;
        }
        const resolved = await this.authorizationContext.resolveUserAuthorization(userId);
        request.authorization = resolved.authorization;
        if (!this.hasRequiredPermissions(resolved, requirement, resource)) {
            throw new common_1.ForbiddenException(this.buildPermissionsErrorMessage(requirement, resource));
        }
        switch (resource.type) {
            case 'global':
            case 'user':
                return true;
            case 'club':
                return this.validateClubScope(userId, request, resolved, resource);
            case 'activity':
                return this.validateInstanceScope(userId, resolved, await this.resolveActivityScope(request, resource));
            case 'finance':
                return this.validateInstanceScope(userId, resolved, await this.resolveFinanceScope(request, resource));
            case 'inventory_instance':
                return this.validateInstanceScope(userId, resolved, await this.resolveInventoryInstanceScope(request, resource));
            case 'inventory_item':
                return this.validateInstanceScope(userId, resolved, await this.resolveInventoryItemScope(request, resource));
            case 'club_assignment':
                return this.validateInstanceScope(userId, resolved, await this.resolveClubAssignmentScope(request, resource));
            default:
                return true;
        }
    }
    hasRequiredPermissions(resolved, requirement, resource) {
        const globalPermissions = this.getGlobalPermissions(resolved);
        const activeClubPermissions = this.getActiveClubPermissions(resolved);
        const candidatePermissions = resource.type === 'global' || resource.type === 'user'
            ? globalPermissions
            : new Set([...globalPermissions, ...activeClubPermissions]);
        if (requirement.mode === 'any') {
            return requirement.permissions.some((permission) => candidatePermissions.has(permission));
        }
        return requirement.permissions.every((permission) => candidatePermissions.has(permission));
    }
    getGlobalPermissions(resolved) {
        return new Set(resolved.authorization.grants.global_roles.flatMap((grant) => grant.permissions));
    }
    getActiveClubPermissions(resolved) {
        const activeAssignmentId = resolved.authorization.active_assignment.assignment_id;
        if (!activeAssignmentId) {
            return new Set();
        }
        const activeGrant = resolved.authorization.grants.club_assignments.find((assignment) => assignment.assignment_id === activeAssignmentId);
        return new Set(activeGrant?.permissions ?? []);
    }
    buildPermissionsErrorMessage(requirement, resource) {
        if (resource.type === 'global' || resource.type === 'user') {
            return `Missing required global permissions: ${requirement.permissions.join(', ')}`;
        }
        return `Missing required permissions: ${requirement.permissions.join(', ')}`;
    }
    async validateClubScope(userId, request, resolved, resource) {
        const clubId = this.getRequiredNumericValue(this.getRequestValue(request, 'param', resource.clubIdParam ?? 'clubId'), 'Club ID not found in request');
        if (await this.authorizationContext.canManageClub(userId, clubId)) {
            return true;
        }
        const activeClubScope = resolved.authorization.effective.scope.club;
        if (!activeClubScope || activeClubScope.club.club_id !== clubId) {
            throw new common_1.ForbiddenException('You need an active club assignment for this club');
        }
        return true;
    }
    async validateInstanceScope(userId, resolved, resourceScope) {
        if (await this.authorizationContext.canManageClub(userId, resourceScope.mainClubId)) {
            return true;
        }
        const activeClubScope = resolved.authorization.effective.scope.club;
        if (!activeClubScope ||
            activeClubScope.club.club_id !== resourceScope.mainClubId ||
            activeClubScope.instance.type !== resourceScope.instanceType ||
            activeClubScope.instance.instance_id !== resourceScope.instanceId) {
            throw new common_1.ForbiddenException('You need an active club assignment for this exact instance');
        }
        return true;
    }
    isResourceOwner(request, userId, resource) {
        const ownerParam = resource.ownerParam ?? 'userId';
        return request.params?.[ownerParam] === userId;
    }
    async resolveActivityScope(request, resource) {
        const activityId = this.getRequiredNumericValue(this.getRequestValue(request, 'param', resource.idParam ?? 'activityId'), 'Activity ID not found in request');
        const activity = await this.prisma.activities.findUnique({
            where: { activity_id: activityId },
            select: {
                club_adv_id: true,
                club_pathf_id: true,
                club_mg_id: true,
                club_adv_i: { select: { main_club_id: true } },
                club_pathf: { select: { main_club_id: true } },
                club_mg: { select: { main_club_id: true } },
            },
        });
        if (!activity) {
            throw new common_1.NotFoundException('Activity not found');
        }
        return this.buildInstanceScopeFromRecord({
            club_adv_id: activity.club_adv_id,
            club_pathf_id: activity.club_pathf_id,
            club_mg_id: activity.club_mg_id,
            club_adventurers: activity.club_adv_i,
            club_pathfinders: activity.club_pathf,
            club_master_guild: activity.club_mg,
        });
    }
    async resolveFinanceScope(request, resource) {
        const financeId = this.getRequiredNumericValue(this.getRequestValue(request, 'param', resource.idParam ?? 'financeId'), 'Finance ID not found in request');
        const finance = await this.prisma.finances.findUnique({
            where: { finance_id: financeId },
            select: {
                club_adv_id: true,
                club_pathf_id: true,
                club_mg_id: true,
                club_adventurers: { select: { main_club_id: true } },
                club_pathfinders: { select: { main_club_id: true } },
                club_master_guild: { select: { main_club_id: true } },
            },
        });
        if (!finance) {
            throw new common_1.NotFoundException('Finance record not found');
        }
        return this.buildInstanceScopeFromRecord(finance);
    }
    async resolveInventoryInstanceScope(request, resource) {
        const instanceId = this.getRequiredNumericValue(this.getRequestValue(request, 'param', resource.idParam ?? 'clubId'), 'Inventory instance ID not found in request');
        const rawInstanceType = this.getRequestValue(request, resource.instanceTypeSource ?? 'query', resource.instanceTypeField ?? 'instanceType');
        const instanceType = this.normalizeInstanceType(rawInstanceType);
        switch (instanceType) {
            case 'adventurers': {
                const instance = await this.prisma.club_adventurers.findUnique({
                    where: { club_adv_id: instanceId },
                    select: { club_adv_id: true, main_club_id: true },
                });
                if (!instance) {
                    throw new common_1.NotFoundException('Club adventurers instance not found');
                }
                return {
                    mainClubId: this.requireMainClubId(instance.main_club_id, 'Club adventurers instance does not belong to a main club'),
                    instanceType,
                    instanceId: instance.club_adv_id,
                };
            }
            case 'pathfinders': {
                const instance = await this.prisma.club_pathfinders.findUnique({
                    where: { club_pathf_id: instanceId },
                    select: { club_pathf_id: true, main_club_id: true },
                });
                if (!instance) {
                    throw new common_1.NotFoundException('Club pathfinders instance not found');
                }
                return {
                    mainClubId: this.requireMainClubId(instance.main_club_id, 'Club pathfinders instance does not belong to a main club'),
                    instanceType,
                    instanceId: instance.club_pathf_id,
                };
            }
            case 'master_guilds': {
                const instance = await this.prisma.club_master_guilds.findUnique({
                    where: { club_mg_id: instanceId },
                    select: { club_mg_id: true, main_club_id: true },
                });
                if (!instance) {
                    throw new common_1.NotFoundException('Club master guilds instance not found');
                }
                return {
                    mainClubId: this.requireMainClubId(instance.main_club_id, 'Club master guilds instance does not belong to a main club'),
                    instanceType,
                    instanceId: instance.club_mg_id,
                };
            }
        }
    }
    async resolveInventoryItemScope(request, resource) {
        const inventoryId = this.getRequiredNumericValue(this.getRequestValue(request, 'param', resource.idParam ?? 'id'), 'Inventory item ID not found in request');
        const inventoryItem = await this.prisma.club_inventory.findUnique({
            where: { club_inventory_id: inventoryId },
            select: {
                club_adv_id: true,
                club_pathf_id: true,
                club_mg_id: true,
                club_adventurers: { select: { main_club_id: true } },
                club_pathfinders: { select: { main_club_id: true } },
                club_master_guild: { select: { main_club_id: true } },
            },
        });
        if (!inventoryItem) {
            throw new common_1.NotFoundException('Inventory item not found');
        }
        return this.buildInstanceScopeFromRecord(inventoryItem);
    }
    async resolveClubAssignmentScope(request, resource) {
        const assignmentId = String(this.getRequestValue(request, 'param', resource.idParam ?? 'assignmentId'));
        if (!assignmentId) {
            throw new common_1.ForbiddenException('Assignment ID not found in request');
        }
        const assignment = await this.prisma.club_role_assignments.findUnique({
            where: { assignment_id: assignmentId },
            select: {
                club_adv_id: true,
                club_pathf_id: true,
                club_mg_id: true,
                club_adventurers: { select: { main_club_id: true } },
                club_pathfinders: { select: { main_club_id: true } },
                club_master_guild: { select: { main_club_id: true } },
            },
        });
        if (!assignment) {
            throw new common_1.NotFoundException('Club assignment not found');
        }
        return this.buildInstanceScopeFromRecord(assignment);
    }
    buildInstanceScopeFromRecord(record) {
        if (record.club_adv_id && record.club_adventurers?.main_club_id) {
            return {
                mainClubId: this.requireMainClubId(record.club_adventurers.main_club_id, 'Club adventurers resource does not belong to a main club'),
                instanceType: 'adventurers',
                instanceId: record.club_adv_id,
            };
        }
        if (record.club_pathf_id && record.club_pathfinders?.main_club_id) {
            return {
                mainClubId: this.requireMainClubId(record.club_pathfinders.main_club_id, 'Club pathfinders resource does not belong to a main club'),
                instanceType: 'pathfinders',
                instanceId: record.club_pathf_id,
            };
        }
        if (record.club_mg_id && record.club_master_guild?.main_club_id) {
            return {
                mainClubId: this.requireMainClubId(record.club_master_guild.main_club_id, 'Club master guild resource does not belong to a main club'),
                instanceType: 'master_guilds',
                instanceId: record.club_mg_id,
            };
        }
        throw new common_1.ForbiddenException('Unable to resolve the club instance for this resource');
    }
    getRequestValue(request, source, field) {
        switch (source) {
            case 'query':
                return request.query?.[field];
            case 'body':
                return request.body?.[field];
            case 'param':
            default:
                return request.params?.[field];
        }
    }
    getRequiredNumericValue(value, errorMessage) {
        const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
            throw new common_1.ForbiddenException(errorMessage);
        }
        return parsed;
    }
    normalizeInstanceType(rawValue) {
        const value = String(rawValue ?? '').trim().toLowerCase();
        if (value === 'adv' || value === 'adventurers') {
            return 'adventurers';
        }
        if (value === 'pathf' || value === 'pathfinders') {
            return 'pathfinders';
        }
        if (value === 'mg' || value === 'master_guilds') {
            return 'master_guilds';
        }
        throw new common_1.ForbiddenException('Instance type not found in request');
    }
    requireMainClubId(value, errorMessage) {
        if (!Number.isFinite(value)) {
            throw new common_1.ForbiddenException(errorMessage);
        }
        return value;
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        authorization_context_service_1.AuthorizationContextService,
        prisma_service_1.PrismaService])
], PermissionsGuard);
//# sourceMappingURL=permissions.guard.js.map