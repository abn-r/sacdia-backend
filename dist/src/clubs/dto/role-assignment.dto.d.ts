import { ClubInstanceType } from './instance.dto';
export declare class AssignRoleDto {
    user_id: string;
    role_id?: string;
    role?: string;
    instance_type?: ClubInstanceType;
    instance_id?: number;
    ecclesiastical_year_id?: number;
    start_date?: Date;
    end_date?: Date;
}
export declare class UpdateRoleAssignmentDto {
    role_id?: string;
    role?: string;
    ecclesiastical_year_id?: number;
    start_date?: Date;
    end_date?: Date;
    status?: string;
}
