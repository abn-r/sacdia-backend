export declare class CreateCountryDto {
    name: string;
    abbreviation: string;
    active?: boolean;
}
export declare class UpdateCountryDto {
    name?: string;
    abbreviation?: string;
    active?: boolean;
}
export declare class CreateUnionDto {
    name: string;
    abbreviation: string;
    country_id: number;
    active?: boolean;
}
export declare class UpdateUnionDto {
    name?: string;
    abbreviation?: string;
    country_id?: number;
    active?: boolean;
}
export declare class CreateLocalFieldDto {
    name: string;
    abbreviation: string;
    union_id: number;
    active?: boolean;
}
export declare class UpdateLocalFieldDto {
    name?: string;
    abbreviation?: string;
    union_id?: number;
    active?: boolean;
}
export declare class CreateDistrictDto {
    name: string;
    local_field_id: number;
    active?: boolean;
}
export declare class UpdateDistrictDto {
    name?: string;
    local_field_id?: number;
    active?: boolean;
}
export declare class CreateChurchDto {
    name: string;
    district_id: number;
    active?: boolean;
}
export declare class UpdateChurchDto {
    name?: string;
    district_id?: number;
    active?: boolean;
}
