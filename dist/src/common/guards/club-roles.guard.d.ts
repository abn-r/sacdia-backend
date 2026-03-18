import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
export declare const CLUB_ROLES_KEY = "club_roles";
export type ClubRoleType = 'director' | 'deputy_director' | 'secretary' | 'treasurer' | 'counselor' | 'instructor' | 'captain' | 'member';
export declare class ClubRolesGuard implements CanActivate {
    private readonly reflector;
    private readonly authorizationContext;
    constructor(reflector: Reflector, authorizationContext: AuthorizationContextService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private extractClubId;
}
