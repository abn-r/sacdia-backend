import { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthorizationContextService } from '../services/authorization-context.service';
export declare class OwnerOrAdminGuard implements CanActivate {
    private readonly authorizationContext;
    constructor(authorizationContext: AuthorizationContextService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
