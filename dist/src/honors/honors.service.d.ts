import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { StartHonorDto, UpdateUserHonorDto, HonorFiltersDto } from './dto';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
export declare class HonorsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(filters?: HonorFiltersDto, pagination?: PaginationDto): Promise<PaginatedResult<any>>;
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
        year: string | null;
        club_type_id: number;
        material_url: string;
        honor_id: number;
        honor_image: string;
        honors_category_id: number;
        master_honors_id: number | null;
        approval: number;
        skill_level: number;
    }>;
    getCategories(): Promise<{
        name: string;
        description: string | null;
        honor_category_id: number;
        icon: number;
    }[]>;
    getUserHonors(userId: string, validated?: boolean): Promise<({
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
        honor_id: number;
        user_honor_id: number;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        date: Date;
    })[]>;
    startHonor(userId: string, honorId: number, dto?: StartHonorDto): Promise<{
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
        honor_id: number;
        user_honor_id: number;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        date: Date;
    }>;
    updateUserHonor(userId: string, honorId: number, dto: UpdateUserHonorDto): Promise<{
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
        honor_id: number;
        user_honor_id: number;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        date: Date;
    }>;
    abandonHonor(userId: string, honorId: number): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        certificate: string;
        honor_id: number;
        user_honor_id: number;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        date: Date;
    }>;
    getUserHonorStats(userId: string): Promise<{
        total: number;
        validated: number;
        in_progress: number;
    }>;
}
