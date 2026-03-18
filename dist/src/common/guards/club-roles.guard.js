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
exports.ClubRolesGuard = exports.CLUB_ROLES_KEY = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const authorization_context_service_1 = require("../services/authorization-context.service");
exports.CLUB_ROLES_KEY = 'club_roles';
const CLUB_ROLE_ALIASES = {
    subdirector: 'deputy_director',
    secretario: 'secretary',
    tesorero: 'treasurer',
    consejero: 'counselor',
};
function normalizeClubRoleName(roleName) {
    const normalized = roleName.toLowerCase();
    return CLUB_ROLE_ALIASES[normalized] ?? normalized;
}
let ClubRolesGuard = class ClubRolesGuard {
    reflector;
    authorizationContext;
    constructor(reflector, authorizationContext) {
        this.reflector = reflector;
        this.authorizationContext = authorizationContext;
    }
    async canActivate(context) {
        const requiredRoles = this.reflector.getAllAndOverride(exports.CLUB_ROLES_KEY, [context.getHandler(), context.getClass()]);
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user || !user.sub) {
            throw new common_1.ForbiddenException('User not authenticated');
        }
        const clubId = this.extractClubId(request);
        if (!clubId) {
            throw new common_1.ForbiddenException('Club ID not found in request');
        }
        if (await this.authorizationContext.canManageClub(user.sub, clubId)) {
            return true;
        }
        const resolved = await this.authorizationContext.resolveUserAuthorization(user.sub);
        const activeClubScope = resolved.authorization.effective.scope.club;
        if (!activeClubScope || activeClubScope.club.club_id !== clubId) {
            throw new common_1.ForbiddenException('You need an active club assignment for this club');
        }
        const hasRole = requiredRoles
            .map((requiredRole) => normalizeClubRoleName(requiredRole))
            .includes(normalizeClubRoleName(activeClubScope.role_name));
        if (!hasRole) {
            throw new common_1.ForbiddenException(`You need one of these club roles: ${requiredRoles.join(', ')}`);
        }
        return true;
    }
    extractClubId(request) {
        if (request.params?.clubId) {
            return parseInt(request.params.clubId, 10);
        }
        if (request.body?.club_id) {
            return parseInt(request.body.club_id, 10);
        }
        if (request.query?.clubId) {
            return parseInt(request.query.clubId, 10);
        }
        return null;
    }
};
exports.ClubRolesGuard = ClubRolesGuard;
exports.ClubRolesGuard = ClubRolesGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        authorization_context_service_1.AuthorizationContextService])
], ClubRolesGuard);
//# sourceMappingURL=club-roles.guard.js.map