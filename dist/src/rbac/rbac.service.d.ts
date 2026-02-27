import { PrismaService } from '../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
export declare class RbacService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    listPermissions(): Promise<{
        created_at: Date | null;
        description: string | null;
        active: boolean;
        modified_at: Date | null;
        permission_id: string;
        permission_name: string;
    }[]>;
    getPermissionById(id: string): Promise<{
        created_at: Date | null;
        description: string | null;
        active: boolean;
        modified_at: Date | null;
        permission_id: string;
        permission_name: string;
    }>;
    createPermission(dto: CreatePermissionDto): Promise<{
        created_at: Date | null;
        description: string | null;
        active: boolean;
        modified_at: Date | null;
        permission_id: string;
        permission_name: string;
    }>;
    updatePermission(id: string, dto: UpdatePermissionDto): Promise<{
        created_at: Date | null;
        description: string | null;
        active: boolean;
        modified_at: Date | null;
        permission_id: string;
        permission_name: string;
    }>;
    deletePermission(id: string): Promise<{
        success: boolean;
        message: string;
    }>;
    listRoles(): Promise<({
        role_permissions: ({
            permissions: {
                description: string | null;
                permission_id: string;
                permission_name: string;
            };
        } & {
            created_at: Date | null;
            active: boolean;
            modified_at: Date | null;
            role_id: string;
            role_permission_id: string;
            permission_id: string;
        })[];
    } & {
        created_at: Date | null;
        active: boolean;
        modified_at: Date | null;
        role_id: string;
        role_name: string;
        role_category: import("@prisma/client").$Enums.role_category;
    })[]>;
    getRoleWithPermissions(roleId: string): Promise<{
        role_permissions: ({
            permissions: {
                description: string | null;
                permission_id: string;
                permission_name: string;
            };
        } & {
            created_at: Date | null;
            active: boolean;
            modified_at: Date | null;
            role_id: string;
            role_permission_id: string;
            permission_id: string;
        })[];
    } & {
        created_at: Date | null;
        active: boolean;
        modified_at: Date | null;
        role_id: string;
        role_name: string;
        role_category: import("@prisma/client").$Enums.role_category;
    }>;
    assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<{
        success: boolean;
        message: string;
        created: number;
        reactivated: number;
    }>;
    removePermissionFromRole(roleId: string, permissionId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    syncRolePermissions(roleId: string, permissionIds: string[]): Promise<{
        success: boolean;
        added: number;
        removed: number;
    }>;
}
