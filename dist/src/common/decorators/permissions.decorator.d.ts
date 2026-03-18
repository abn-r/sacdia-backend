export declare const PERMISSIONS_KEY = "permissions";
export type PermissionMode = 'all' | 'any';
export type PermissionRequirement = {
    permissions: string[];
    mode: PermissionMode;
};
export declare function RequirePermissions(...permissions: string[]): ClassDecorator & MethodDecorator;
export declare function RequirePermissions(requirement: PermissionRequirement): ClassDecorator & MethodDecorator;
