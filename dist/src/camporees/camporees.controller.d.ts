import { CamporeesService } from './camporees.service';
import { CreateCamporeeDto, UpdateCamporeeDto, RegisterMemberDto } from './dto';
export declare class CamporeesController {
    private readonly camporeesService;
    constructor(camporeesService: CamporeesService);
    findAll(active?: string, page?: number, limit?: number): Promise<import("../common/dto/pagination.dto").PaginatedResult<any>>;
    findOne(camporeeId: number): Promise<{
        local_fields: {
            name: string;
            local_field_id: number;
            abbreviation: string;
        };
        attending_members_camporees: {
            user_id: string;
            camporee_member_id: number;
            insurance_verified: boolean;
        }[];
        ecclesiastical_year_relation: {
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    } & {
        created_at: Date;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number;
        start_date: Date;
        end_date: Date;
        ecclesiastical_year: number;
        includes_adventurers: boolean | null;
        includes_pathfinders: boolean | null;
        includes_master_guides: boolean | null;
        local_camporee_place: string;
        registration_cost: import("@prisma/client/runtime/client").Decimal | null;
        local_camporee_id: number;
    }>;
    create(dto: CreateCamporeeDto, req: any): Promise<{
        local_fields: {
            name: string;
            local_field_id: number;
            abbreviation: string;
        };
        ecclesiastical_year_relation: {
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    } & {
        created_at: Date;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number;
        start_date: Date;
        end_date: Date;
        ecclesiastical_year: number;
        includes_adventurers: boolean | null;
        includes_pathfinders: boolean | null;
        includes_master_guides: boolean | null;
        local_camporee_place: string;
        registration_cost: import("@prisma/client/runtime/client").Decimal | null;
        local_camporee_id: number;
    }>;
    update(camporeeId: number, dto: UpdateCamporeeDto): Promise<{
        local_fields: {
            name: string;
            local_field_id: number;
            abbreviation: string;
        };
        ecclesiastical_year_relation: {
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    } & {
        created_at: Date;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number;
        start_date: Date;
        end_date: Date;
        ecclesiastical_year: number;
        includes_adventurers: boolean | null;
        includes_pathfinders: boolean | null;
        includes_master_guides: boolean | null;
        local_camporee_place: string;
        registration_cost: import("@prisma/client/runtime/client").Decimal | null;
        local_camporee_id: number;
    }>;
    remove(camporeeId: number): Promise<{
        created_at: Date;
        description: string | null;
        name: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number;
        start_date: Date;
        end_date: Date;
        ecclesiastical_year: number;
        includes_adventurers: boolean | null;
        includes_pathfinders: boolean | null;
        includes_master_guides: boolean | null;
        local_camporee_place: string;
        registration_cost: import("@prisma/client/runtime/client").Decimal | null;
        local_camporee_id: number;
    }>;
    registerMember(camporeeId: number, dto: RegisterMemberDto): Promise<{
        users: {
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            email: string;
            user_id: string;
            user_image: string | null;
        };
        insurance: {
            start_date: Date;
            end_date: Date;
            provider: string | null;
            insurance_id: number;
            insurance_type: import("@prisma/client").$Enums.insurance_type_enum;
            policy_number: string | null;
        } | null;
    } & {
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number | null;
        club_name: string | null;
        camporee_type: string;
        insurance_id: number | null;
        camporee_member_id: number;
        camporee_id: number;
        insurance_verified: boolean;
    }>;
    getMembers(camporeeId: number): Promise<({
        users: {
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            email: string;
            user_id: string;
            birthday: Date | null;
            user_image: string | null;
        };
        insurance: {
            start_date: Date;
            end_date: Date;
            provider: string | null;
            insurance_id: number;
            insurance_type: import("@prisma/client").$Enums.insurance_type_enum;
            policy_number: string | null;
        } | null;
    } & {
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number | null;
        club_name: string | null;
        camporee_type: string;
        insurance_id: number | null;
        camporee_member_id: number;
        camporee_id: number;
        insurance_verified: boolean;
    })[]>;
    removeMember(camporeeId: number, userId: string): Promise<{
        created_at: Date;
        user_id: string;
        active: boolean;
        modified_at: Date;
        local_field_id: number | null;
        club_name: string | null;
        camporee_type: string;
        insurance_id: number | null;
        camporee_member_id: number;
        camporee_id: number;
        insurance_verified: boolean;
    }>;
}
