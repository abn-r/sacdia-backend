import { RbacService } from './rbac.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
export declare class RbacController {
    private readonly rbacService;
    constructor(rbacService: RbacService);
    listPermissions(): Promise<{
        status: string;
        data: {
            created_at: Date | null;
            description: string | null;
            active: boolean;
            modified_at: Date | null;
            permission_id: string;
            permission_name: string;
        }[];
    }>;
    getPermission(id: string): Promise<{
        status: string;
        data: {
            created_at: Date | null;
            description: string | null;
            active: boolean;
            modified_at: Date | null;
            permission_id: string;
            permission_name: string;
        };
    }>;
    createPermission(dto: CreatePermissionDto): Promise<{
        status: string;
        data: {
            created_at: Date | null;
            description: string | null;
            active: boolean;
            modified_at: Date | null;
            permission_id: string;
            permission_name: string;
        };
    }>;
    updatePermission(id: string, dto: UpdatePermissionDto): Promise<{
        status: string;
        data: {
            created_at: Date | null;
            description: string | null;
            active: boolean;
            modified_at: Date | null;
            permission_id: string;
            permission_name: string;
        };
    }>;
    deletePermission(id: string): Promise<{
        success: boolean;
        message: string;
    }>;
    listRoles(): Promise<{
        status: string;
        data: ({
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
        })[];
    }>;
    getRole(id: string): Promise<{
        status: string;
        data: {
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
        };
    }>;
    assignPermissions(id: string, dto: AssignPermissionsDto): Promise<{
        success: boolean;
        message: string;
        created: number;
        reactivated: number;
    }>;
    syncPermissions(id: string, dto: AssignPermissionsDto): Promise<{
        success: boolean;
        added: number;
        removed: number;
    }>;
    removePermission(id: string, permissionId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
