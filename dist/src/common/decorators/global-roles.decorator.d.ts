export declare const GLOBAL_ROLES_KEY = "global_roles";
export type GlobalRoleType = 'super_admin' | 'admin' | 'assistant_admin' | 'coordinator' | 'pastor' | 'user';
export declare const GlobalRoles: (...roles: GlobalRoleType[]) => import("@nestjs/common").CustomDecorator<string>;
