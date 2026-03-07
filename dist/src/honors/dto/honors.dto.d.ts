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
export declare class CreateUserHonorDto {
    honorId: number;
    date?: string;
    validate?: boolean;
    certificate?: string | null;
    images?: string[] | null;
    document?: string | null;
}
export declare class BulkCreateUserHonorsDto {
    honors: CreateUserHonorDto[];
}
export declare class HonorFiltersDto {
    categoryId?: number;
    clubTypeId?: number;
    skillLevel?: number;
}
