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
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, fileStorage: FileStorageService);
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
        emergency_contacts: {
            name: string;
            phone: string;
            relationship_type_id: string;
            primary: boolean;
            emergency_id: number;
        }[];
        legal_representative: {
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            id: string;
            phone: string | null;
            relationship_type_id: string | null;
            representative_user_id: string | null;
        } | null;
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
        post_registration: {
            complete: any;
            profile_picture_complete: any;
            personal_info_complete: any;
            club_selection_complete: any;
        } | null;
        created_at: any;
    }>;
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
