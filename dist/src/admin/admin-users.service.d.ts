import { AuthorizationContextService } from '../common/services/authorization-context.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListUsersQueryDto } from './dto';
type ScopeType = 'ALL' | 'UNION' | 'LOCAL_FIELD';
interface ScopeMeta {
    type: ScopeType;
    roles: string[];
    union_id: number | null;
    local_field_id: number | null;
}
interface AdminUsersListResult<T> {
    data: T[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        scope: ScopeMeta;
    };
}
export declare class AdminUsersService {
    private readonly prisma;
    private readonly authorizationContext;
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, authorizationContext: AuthorizationContextService, fileStorage: FileStorageService);
    listUsers(actorUserId: string, query: AdminListUsersQueryDto): Promise<AdminUsersListResult<any>>;
    getUserById(actorUserId: string, userId: string): Promise<{
        gender: string | null;
        birthday: Date | null;
        blood: import("@prisma/client").$Enums.blood_type | null;
        baptism: boolean;
        baptism_date: Date | null;
        user_image: string | null;
        modified_at: Date;
        classes: {
            user_class_id: number;
            class_id: number;
            class_name: string;
            investiture: boolean;
            date_investiture: Date | null;
            advanced: boolean;
            current_class: boolean;
        }[];
        club_assignments: {
            assignment_id: string;
            role_name: string;
            start_date: Date;
            end_date: Date | null;
            ecclesiastical_year: {
                start_date: Date;
                end_date: Date;
                year_id: number;
            };
            club: {
                type: string;
                instance_id: any;
                club: any;
            } | null;
        }[];
        health: Record<string, unknown> | null;
        emergency_contacts: unknown[] | null;
        legal_representative: Record<string, unknown> | null;
        post_registration: Record<string, unknown> | null;
        scope: ScopeMeta;
        user_id: any;
        email: any;
        name: any;
        paternal_last_name: any;
        maternal_last_name: any;
        full_name: string;
        active: any;
        access_app: any;
        access_panel: any;
        country: {
            country_id: any;
            name: any;
        } | null;
        union: {
            union_id: any;
            name: any;
        } | null;
        local_field: {
            local_field_id: any;
            union_id: any;
            name: any;
        } | null;
        roles: string[];
        created_at: any;
    }>;
    private getActorGlobalPermissions;
    private buildSensitiveBlocks;
    private canReadSensitiveFamily;
    private buildHealthBlock;
    private buildMinimalPostRegistrationBlock;
    private resolveScope;
    private buildListWhere;
    private buildScopeWhere;
    private toScopeMeta;
    private extractRoleNames;
    private toListItem;
    private resolvePrivateProfileUrl;
    private resolveClubAssignment;
}
export {};
