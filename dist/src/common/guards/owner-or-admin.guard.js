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
exports.OwnerOrAdminGuard = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let OwnerOrAdminGuard = class OwnerOrAdminGuard {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user || !user.sub) {
            throw new common_1.ForbiddenException('User not authenticated');
        }
        const resourceUserId = request.params?.userId;
        if (!resourceUserId) {
            throw new common_1.ForbiddenException('User ID not found in request parameters');
        }
        if (user.sub === resourceUserId) {
            return true;
        }
        const isAdmin = await this.checkAdminRole(user.sub);
        if (isAdmin) {
            return true;
        }
        throw new common_1.ForbiddenException('You can only access your own resources unless you have admin privileges');
    }
    async checkAdminRole(userId) {
        const adminRoles = ['admin', 'assistant_admin', 'coordinator', 'super_admin'];
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
        return adminRoles.some((adminRole) => activeRoleNames.includes(adminRole.toLowerCase()));
    }
};
exports.OwnerOrAdminGuard = OwnerOrAdminGuard;
exports.OwnerOrAdminGuard = OwnerOrAdminGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OwnerOrAdminGuard);
//# sourceMappingURL=owner-or-admin.guard.js.map