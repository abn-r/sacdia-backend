import { HonorsService } from './honors.service';
import { StartHonorDto, UpdateUserHonorDto, CreateUserHonorDto, BulkCreateUserHonorsDto } from './dto';
export declare class HonorsController {
    private readonly honorsService;
    constructor(honorsService: HonorsService);
    findAll(categoryId?: number, clubTypeId?: number, skillLevel?: number, page?: number, limit?: number): Promise<import("../common/dto/pagination.dto").PaginatedResult<any>>;
    getCategories(): Promise<{
        name: string;
        description: string | null;
        honor_category_id: number;
        icon: number;
    }[]>;
    getGroupedByCategory(categoryId?: number, clubTypeId?: number, skillLevel?: number): Promise<{
        category: {
            honor_category_id: number | null;
            name: string;
            description: string | null;
            icon: number | null;
        };
        honors: {
            honor_id: number;
            name: string;
            description: string | null;
            honor_image: string | null;
            skill_level: number | null;
            club_type_id: number | null;
            club_type_name: string | null;
        }[];
    }[]>;
    findOne(honorId: number): Promise<{
        club_types: {
            name: string;
        };
        honors_categories: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            description: string | null;
            honor_category_id: number;
            icon: number;
        };
        master_honors: {
            name: string;
        } | null;
    } & {
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date | null;
        description: string | null;
        club_type_id: number;
        year: string | null;
        material_url: string;
        honor_id: number;
        honor_image: string;
        honors_category_id: number;
        master_honors_id: number | null;
        approval: number;
        skill_level: number;
    }>;
}
export declare class UserHonorsController {
    private readonly honorsService;
    constructor(honorsService: HonorsService);
    getUserHonors(userId: string, validated?: string): Promise<({
        honors: {
            honors_categories: {
                name: string;
                icon: number;
            };
            name: string;
            honor_id: number;
            honor_image: string;
            skill_level: number;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    })[]>;
    getStats(userId: string): Promise<{
        total: number;
        validated: number;
        in_progress: number;
    }>;
    createUserHonor(userId: string, dto: CreateUserHonorDto): Promise<{
        honors: {
            honors_categories: {
                name: string;
            };
            name: string;
            honor_id: number;
            honor_image: string;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    }>;
    createUserHonorsBulk(userId: string, dto: BulkCreateUserHonorsDto): Promise<({
        honors: {
            honors_categories: {
                name: string;
            };
            name: string;
            honor_id: number;
            honor_image: string;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    })[]>;
    uploadHonorFiles(userId: string, honorId: number, files: {
        certificate?: Express.Multer.File[];
        document?: Express.Multer.File[];
        images?: Express.Multer.File[];
    }): Promise<{
        status: string;
        data: {
            user_honor: any;
            uploaded: {
                certificate: string | null;
                document: string | null;
                images: (string | null)[];
            };
        };
        message: string;
    }>;
    startHonor(userId: string, honorId: number, dto: StartHonorDto): Promise<{
        honors: {
            honors_categories: {
                name: string;
            };
            name: string;
            honor_image: string;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    }>;
    updateHonor(userId: string, honorId: number, dto: UpdateUserHonorDto): Promise<{
        honors: {
            name: string;
            honor_image: string;
        };
    } & {
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    }>;
    abandonHonor(userId: string, honorId: number): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        date: Date;
        validate: boolean;
        images: import("@prisma/client/runtime/client").JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    }>;
}
