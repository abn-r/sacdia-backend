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
const authorization_context_service_1 = require("../services/authorization-context.service");
const global_roles_decorator_1 = require("../decorators/global-roles.decorator");
const GLOBAL_ROLE_ALIASES = {
    super_admin: ['super_admin'],
    admin: ['admin', 'assistant_admin'],
    assistant_admin: ['assistant_admin', 'admin'],
    coordinator: ['coordinator'],
    pastor: ['pastor'],
    user: ['user'],
};
let GlobalRolesGuard = class GlobalRolesGuard {
    reflector;
    authorizationContext;
    constructor(reflector, authorizationContext) {
        this.reflector = reflector;
        this.authorizationContext = authorizationContext;
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
        const acceptedRoles = Array.from(new Set(requiredRoles.flatMap((requiredRole) => GLOBAL_ROLE_ALIASES[requiredRole] ?? [requiredRole])));
        const hasRole = await this.authorizationContext.hasAnyGlobalRole(user.sub, acceptedRoles);
        if (!hasRole) {
            throw new common_1.ForbiddenException(`You need one of these global roles: ${requiredRoles.join(', ')}`);
        }
        return true;
    }
};
exports.GlobalRolesGuard = GlobalRolesGuard;
exports.GlobalRolesGuard = GlobalRolesGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        authorization_context_service_1.AuthorizationContextService])
], GlobalRolesGuard);
//# sourceMappingURL=global-roles.guard.js.map