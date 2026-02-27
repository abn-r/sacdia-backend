import { ClubsService } from './clubs.service';
import { CreateClubDto, UpdateClubDto, CreateInstanceDto, UpdateInstanceDto, AssignRoleDto, UpdateRoleAssignmentDto, ClubInstanceType } from './dto';
export declare class ClubsController {
    private readonly clubsService;
    constructor(clubsService: ClubsService);
    findAll(localFieldId?: number, districtId?: number, churchId?: number, active?: string, page?: number, limit?: number): Promise<import("../common/dto/pagination.dto").PaginatedResult<any>>;
    findOne(clubId: number): Promise<{
        churches: {
            created_at: Date | null;
            name: string;
            active: boolean;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        };
        club_adventurers: {
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_adv_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        club_pathfinders: {
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_pathf_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        districts: {
            created_at: Date | null;
            name: string;
            active: boolean;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        };
        local_fields: {
            created_at: Date | null;
            name: string;
            active: boolean;
            modified_at: Date | null;
            union_id: number;
            local_field_id: number;
            abbreviation: string;
        };
        club_master_guild: {
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_mg_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
    } & {
        created_at: Date | null;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: import("@prisma/client/runtime/client").JsonValue;
    }>;
    create(dto: CreateClubDto): Promise<{
        created_at: Date | null;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: import("@prisma/client/runtime/client").JsonValue;
    }>;
    update(clubId: number, dto: UpdateClubDto): Promise<{
        created_at: Date | null;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: import("@prisma/client/runtime/client").JsonValue;
    }>;
    remove(clubId: number): Promise<{
        created_at: Date | null;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        club_id: number;
        address: string | null;
        districlub_type_id: number;
        church_id: number;
        coordinates: import("@prisma/client/runtime/client").JsonValue;
    }>;
    getInstances(clubId: number): Promise<{
        adventurers: {
            club_type_name: string;
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_adv_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        pathfinders: {
            club_type_name: string;
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_pathf_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
        master_guilds: {
            club_type_name: string;
            created_at: Date;
            active: boolean;
            modified_at: Date;
            club_mg_id: number;
            souls_target: number;
            fee: number;
            meeting_day: import("@prisma/client/runtime/client").JsonValue[];
            meeting_time: import("@prisma/client/runtime/client").JsonValue[];
            club_type_id: number;
            main_club_id: number | null;
        }[];
    }>;
    getInstance(clubId: number, type: ClubInstanceType): Promise<{
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[] | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[] | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }[]>;
    createInstance(clubId: number, dto: CreateInstanceDto): Promise<{
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }>;
    updateInstance(instanceId: number, type: ClubInstanceType, dto: UpdateInstanceDto): Promise<{
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_adv_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_pathf_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    } | {
        created_at: Date;
        active: boolean;
        modified_at: Date;
        club_mg_id: number;
        souls_target: number;
        fee: number;
        meeting_day: import("@prisma/client/runtime/client").JsonValue[];
        meeting_time: import("@prisma/client/runtime/client").JsonValue[];
        club_type_id: number;
        main_club_id: number | null;
    }>;
    getMembers(instanceId: number, type: ClubInstanceType): Promise<({
        roles: {
            role_id: string;
            role_name: string;
            role_category: import("@prisma/client").$Enums.role_category;
        };
        users: {
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            user_id: string;
            user_image: string | null;
        };
    } & {
        status: string | null;
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        role_id: string;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    })[]>;
    assignRole(dto: AssignRoleDto): Promise<{
        roles: {
            role_name: string;
        };
        users: {
            name: string | null;
            paternal_last_name: string | null;
        };
    } & {
        status: string | null;
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        role_id: string;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
}
export declare class ClubRolesController {
    private readonly clubsService;
    constructor(clubsService: ClubsService);
    updateAssignment(assignmentId: string, dto: UpdateRoleAssignmentDto): Promise<{
        status: string | null;
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        role_id: string;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
    removeAssignment(assignmentId: string): Promise<{
        status: string | null;
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        role_id: string;
        start_date: Date;
        assignment_id: string;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        ecclesiastical_year_id: number;
        end_date: Date | null;
    }>;
}
