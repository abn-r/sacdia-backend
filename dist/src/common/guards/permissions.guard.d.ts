import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizationContextService } from '../services/authorization-context.service';
export declare class PermissionsGuard implements CanActivate {
    private readonly reflector;
    private readonly authorizationContext;
    private readonly prisma;
    constructor(reflector: Reflector, authorizationContext: AuthorizationContextService, prisma: PrismaService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private hasRequiredPermissions;
    private getGlobalPermissions;
    private getActiveClubPermissions;
    private buildPermissionsErrorMessage;
    private validateClubScope;
    private validateInstanceScope;
    private isResourceOwner;
    private resolveActivityScope;
    private resolveFinanceScope;
    private resolveInventoryInstanceScope;
    private resolveInventoryItemScope;
    private resolveClubAssignmentScope;
    private buildInstanceScopeFromRecord;
    private getRequestValue;
    private getRequiredNumericValue;
    private normalizeInstanceType;
    private requireMainClubId;
}
