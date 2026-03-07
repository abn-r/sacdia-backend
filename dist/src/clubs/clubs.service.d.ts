import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateClubDto, UpdateClubDto, CreateInstanceDto, UpdateInstanceDto, AssignRoleDto, UpdateRoleAssignmentDto, ClubInstanceType } from './dto';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
import type { FileStorageService } from '../common/services/file-storage.service';
export declare class ClubsService {
    private readonly prisma;
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, fileStorage: FileStorageService);
    findAll(filters?: {
        localFieldId?: number;
        districtId?: number;
        churchId?: number;
        active?: boolean;
    }, pagination?: PaginationDto): Promise<PaginatedResult<any>>;
    findOne(clubId: number): Promise<{
        churches: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        };
        club_adventurers: {
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_adv_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        club_pathfinders: {
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_pathf_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        districts: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        };
        local_fields: {
            name: string;
            active: boolean;
            union_id: number;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            abbreviation: string;
        };
        club_master_guild: {
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_mg_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
    } & {
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        local_field_id: number;
        description: string | null;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: Prisma.JsonValue;
    }>;
    create(dto: CreateClubDto): Promise<{
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        local_field_id: number;
        description: string | null;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: Prisma.JsonValue;
    }>;
    update(clubId: number, dto: UpdateClubDto): Promise<{
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        local_field_id: number;
        description: string | null;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: Prisma.JsonValue;
    }>;
    remove(clubId: number): Promise<{
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        local_field_id: number;
        description: string | null;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: Prisma.JsonValue;
    }>;
    getInstances(clubId: number): Promise<{
        adventurers: {
            club_type_name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_adv_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        pathfinders: {
            club_type_name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_pathf_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        master_guilds: {
            club_type_name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            club_mg_id: number;
            souls_target: number;
            fee: number;
            meeting_day: Prisma.JsonValue[];
            meeting_time: Prisma.JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
    }>;
    getInstance(clubId: number, type: ClubInstanceType): Promise<{
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[] | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[] | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[]>;
    createInstance(clubId: number, dto: CreateInstanceDto): Promise<{
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }>;
    updateInstance(instanceId: number, type: ClubInstanceType, dto: UpdateInstanceDto): Promise<{
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        active: boolean;
        created_at: Date;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: Prisma.JsonValue[];
        meeting_time: Prisma.JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }>;
    getMembers(instanceId: number, type: ClubInstanceType): Promise<{
        users: {
            user_image: string | null;
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
        };
        roles: {
            role_id: string;
            role_name: string;
            role_category: import("@prisma/client").$Enums.role_category;
        };
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        role_id: string;
        status: string | null;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }[]>;
    assignRole(dto: AssignRoleDto): Promise<{
        roles: {
            role_name: string;
        };
        users: {
            name: string | null;
            paternal_last_name: string | null;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        role_id: string;
        status: string | null;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
    updateRoleAssignment(assignmentId: string, dto: UpdateRoleAssignmentDto): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        role_id: string;
        status: string | null;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
    removeRoleAssignment(assignmentId: string): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        role_id: string;
        status: string | null;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
    private getClubTypeName;
    private getInstanceWhereClause;
    private resolvePrivateProfileUrl;
}
