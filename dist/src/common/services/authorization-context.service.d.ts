import { PrismaService } from '../../prisma/prisma.service';
export type AuthorizationScopeNode = {
    id: number | string;
    name?: string | null;
};
export type AuthorizationTerritoryScope = {
    country?: AuthorizationScopeNode;
    union?: AuthorizationScopeNode;
    local_field?: AuthorizationScopeNode;
};
export type AuthorizationInstanceType = 'adventurers' | 'pathfinders' | 'master_guilds';
export type GlobalAuthorizationGrant = {
    role_name: string;
    permissions: string[];
    scope: AuthorizationTerritoryScope;
};
export type ClubAuthorizationGrant = {
    assignment_id: string;
    role_name: string;
    permissions: string[];
    club: {
        club_id: number;
        club_name: string;
    };
    instance: {
        type: AuthorizationInstanceType;
        instance_id: number;
        instance_name?: string | null;
    };
    scope: AuthorizationTerritoryScope;
    status: string;
    start_date?: Date | null;
    end_date?: Date | null;
};
export type EffectiveClubAuthorization = {
    assignment_id: string;
    role_name: string;
    club: {
        club_id: number;
        club_name: string;
    };
    instance: {
        type: AuthorizationInstanceType;
        instance_id: number;
        instance_name?: string | null;
    };
};
export type AuthorizationSnapshot = {
    grants: {
        global_roles: GlobalAuthorizationGrant[];
        club_assignments: ClubAuthorizationGrant[];
    };
    active_assignment: {
        assignment_id: string | null;
    };
    effective: {
        permissions: string[];
        scope: {
            global: AuthorizationTerritoryScope;
            club: EffectiveClubAuthorization | null;
        };
    };
};
export type LegacyAssignmentContext = {
    assignment_id: string;
    role_name: string;
    instance_type: AuthorizationInstanceType;
    instance_id: number;
    club_id: number;
    club_name: string;
    club_type: string | null;
};
export type ResolvedAuthorizationProfile = {
    profile: {
        user_id: string;
        email: string;
        name: string | null;
        paternal_last_name: string | null;
        maternal_last_name: string | null;
        gender: string | null;
        birthday: Date | null;
        baptism: boolean;
        baptism_date: Date | null;
        user_image: string | null;
        country_id: number | null;
        union_id: number | null;
        local_field_id: number | null;
        created_at: Date;
    };
    post_register_complete: boolean;
    authorization: AuthorizationSnapshot;
    legacy: {
        roles: string[];
        permissions: string[];
        club: {
            club_id: number;
            club_name: string;
            club_type: string | null;
        } | null;
        club_context: {
            active_assignment_id: string | null;
            active: LegacyAssignmentContext | null;
            available: LegacyAssignmentContext[];
        };
    };
};
export declare class AuthorizationContextService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    resolveUserAuthorization(userId: string): Promise<ResolvedAuthorizationProfile>;
    hasAnyGlobalRole(userId: string, roleNames: string[]): Promise<boolean>;
    private buildUserScope;
    private buildClubGrant;
    private buildClubScope;
    private collectPermissionNames;
    private uniqueSorted;
    private toLegacyAssignmentContext;
}
