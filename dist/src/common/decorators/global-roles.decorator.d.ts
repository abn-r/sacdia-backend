export declare const GLOBAL_ROLES_KEY = "global_roles";
export type GlobalRoleType = 'super_admin' | 'admin' | 'coordinator' | 'user';
export declare const GlobalRoles: (...roles: GlobalRoleType[]) => import("@nestjs/common").CustomDecorator<string>;
