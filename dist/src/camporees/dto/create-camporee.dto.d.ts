export declare class CreateCamporeeDto {
    name: string;
    description?: string;
    start_date: string;
    end_date: string;
    local_field_id: number;
    includes_adventurers: boolean;
    includes_pathfinders: boolean;
    includes_master_guides: boolean;
    local_camporee_place: string;
    registration_cost?: number;
}
