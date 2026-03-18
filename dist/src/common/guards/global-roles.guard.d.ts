import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
export declare class GlobalRolesGuard implements CanActivate {
    private readonly reflector;
    private readonly authorizationContext;
    constructor(reflector: Reflector, authorizationContext: AuthorizationContextService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
