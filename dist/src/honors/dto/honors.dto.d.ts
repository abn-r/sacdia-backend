export declare class StartHonorDto {
    date?: string;
}
export declare class UpdateUserHonorDto {
    validate?: boolean;
    certificate?: string | null;
    images?: string[] | null;
    document?: string | null;
    date?: string;
}
export declare class HonorFiltersDto {
    categoryId?: number;
    clubTypeId?: number;
    skillLevel?: number;
}
