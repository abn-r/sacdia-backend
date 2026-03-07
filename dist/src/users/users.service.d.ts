import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserAllergiesDto, UpdateUserDiseasesDto } from './dto/update-user-medical.dto';
import type { FileStorageService } from '../common/services/file-storage.service';
export declare class UsersService {
    private prisma;
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, fileStorage: FileStorageService);
    private ensureUserExists;
    private validateGeographyReferences;
    private validateAllergiesExist;
    private validateDiseasesExist;
    findOne(userId: string): Promise<{
        status: string;
        data: {
            user_id: string;
            email: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            gender: string | null;
            birthday: Date | null;
            blood: import("@prisma/client").$Enums.blood_type | null;
            baptism: boolean;
            baptism_date: Date | null;
            user_image: string | null;
            country_id: number | null;
            union_id: number | null;
            access_app: boolean | null;
            access_panel: boolean | null;
            created_at: Date;
            modified_at: Date;
            local_field_id: number | null;
        };
    }>;
    update(userId: string, updateUserDto: UpdateUserDto): Promise<{
        status: string;
        data: {
            user_id: string;
            email: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            gender: string | null;
            birthday: Date | null;
            blood: import("@prisma/client").$Enums.blood_type | null;
            baptism: boolean;
            baptism_date: Date | null;
            country_id: number | null;
            union_id: number | null;
            modified_at: Date;
            local_field_id: number | null;
        };
        message: string;
    }>;
    updateAllergies(userId: string, dto: UpdateUserAllergiesDto): Promise<{
        status: string;
        data: {
            allergies: {
                name: string;
                description: string | null;
            } | null;
            allergy_id: number | null;
        }[];
        message: string;
    }>;
    updateDiseases(userId: string, dto: UpdateUserDiseasesDto): Promise<{
        status: string;
        data: {
            diseases: {
                name: string;
                description: string | null;
            };
            disease_id: number;
        }[];
        message: string;
    }>;
    removeAllergy(userId: string, allergyId: number): Promise<{
        status: string;
        data: {
            allergy_id: number;
            active: boolean;
        };
        message: string;
    }>;
    removeDisease(userId: string, diseaseId: number): Promise<{
        status: string;
        data: {
            disease_id: number;
            active: boolean;
        };
        message: string;
    }>;
    uploadProfilePicture(userId: string, file: Express.Multer.File): Promise<{
        status: string;
        data: {
            url: string | null;
            fileName: string;
        };
        message: string;
    }>;
    deleteProfilePicture(userId: string): Promise<{
        status: string;
        message: string;
    }>;
    calculateAge(userId: string): Promise<number | null>;
    requiresLegalRepresentative(userId: string): Promise<boolean>;
    private rollbackUploadedObjects;
    private cleanupPreviousProfilePicture;
    private resolvePrivateAssetUrl;
}
