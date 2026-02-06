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
exports.GlobalRolesGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_service_1 = require("../../prisma/prisma.service");
const global_roles_decorator_1 = require("../decorators/global-roles.decorator");
let GlobalRolesGuard = class GlobalRolesGuard {
    reflector;
    prisma;
    constructor(reflector, prisma) {
        this.reflector = reflector;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const requiredRoles = this.reflector.getAllAndOverride(global_roles_decorator_1.GLOBAL_ROLES_KEY, [context.getHandler(), context.getClass()]);
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user || !user.sub) {
            throw new common_1.ForbiddenException('User not authenticated');
        }
        const hasRole = await this.checkUserGlobalRole(user.sub, requiredRoles);
        if (!hasRole) {
            throw new common_1.ForbiddenException(`You need one of these global roles: ${requiredRoles.join(', ')}`);
        }
        return true;
    }
    async checkUserGlobalRole(userId, requiredRoles) {
        const userRoles = await this.prisma.users_roles.findMany({
            where: {
                user_id: userId,
                active: true,
            },
            include: {
                roles: {
                    select: {
                        role_name: true,
                        active: true,
                    },
                },
            },
        });
        const activeRoleNames = userRoles
            .filter((ur) => ur.roles.active)
            .map((ur) => ur.roles.role_name.toLowerCase());
        return requiredRoles.some((requiredRole) => activeRoleNames.includes(requiredRole.toLowerCase()));
    }
};
exports.GlobalRolesGuard = GlobalRolesGuard;
exports.GlobalRolesGuard = GlobalRolesGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        prisma_service_1.PrismaService])
], GlobalRolesGuard);
//# sourceMappingURL=global-roles.guard.js.map