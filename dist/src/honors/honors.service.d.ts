import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { StartHonorDto, UpdateUserHonorDto, HonorFiltersDto, CreateUserHonorDto, BulkCreateUserHonorsDto } from './dto';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
import type { FileStorageService } from '../common/services/file-storage.service';
export declare class HonorsService {
    private readonly prisma;
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, fileStorage: FileStorageService);
    findAll(filters?: HonorFiltersDto, pagination?: PaginationDto): Promise<PaginatedResult<any>>;
    getGroupedByCategory(filters?: HonorFiltersDto): Promise<{
        category: {
            honor_category_id: number | null;
            name: string;
            description: string | null;
            icon: number | null;
        };
        honors: Array<{
            honor_id: number;
            name: string;
            description: string | null;
            honor_image: string | null;
            skill_level: number | null;
            club_type_id: number | null;
            club_type_name: string | null;
        }>;
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
        date: Date;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
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
        date: Date;
        validate: boolean;
        images: Prisma.JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
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
        images: Prisma.JsonValue;
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
        images: Prisma.JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    })[]>;
    uploadUserHonorFiles(userId: string, honorId: number, files: {
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
        date: Date;
        validate: boolean;
        images: Prisma.JsonValue;
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
        images: Prisma.JsonValue;
        document: string | null;
        honor_id: number;
        user_honor_id: number;
    }>;
    getUserHonorStats(userId: string): Promise<{
        total: number;
        validated: number;
        in_progress: number;
    }>;
    private buildCreateDataFromCreateDto;
    private buildUpdateDataFromCreateDto;
    private extractImageUrls;
    private getFileExtension;
    private validateCertificateFile;
    private validateImageFile;
    private validateDocumentFile;
    private rollbackUploadedObjects;
    private cleanupPreviousCertificate;
    private cleanupPreviousDocument;
    private mapUserHonorPrivateUrls;
    private resolvePrivateAssetUrl;
}
