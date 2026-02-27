import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserAllergiesDto, UpdateUserDiseasesDto } from './dto/update-user-medical.dto';
export declare class UsersService {
    private prisma;
    private supabase;
    private readonly logger;
    constructor(prisma: PrismaService, supabase: SupabaseService);
    private ensureUserExists;
    private validateGeographyReferences;
    private validateAllergiesExist;
    private validateDiseasesExist;
    findOne(userId: string): Promise<{
        status: string;
        data: {
            created_at: Date;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            email: string;
            user_id: string;
            gender: string | null;
            birthday: Date | null;
            blood: import("@prisma/client").$Enums.blood_type | null;
            baptism: boolean;
            baptism_date: Date | null;
            user_image: string | null;
            access_app: boolean | null;
            access_panel: boolean | null;
            modified_at: Date;
            country_id: number | null;
            union_id: number | null;
            local_field_id: number | null;
        };
    }>;
    update(userId: string, updateUserDto: UpdateUserDto): Promise<{
        status: string;
        data: {
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            email: string;
            user_id: string;
            gender: string | null;
            birthday: Date | null;
            blood: import("@prisma/client").$Enums.blood_type | null;
            baptism: boolean;
            baptism_date: Date | null;
            modified_at: Date;
            country_id: number | null;
            union_id: number | null;
            local_field_id: number | null;
        };
        message: string;
    }>;
    updateAllergies(userId: string, dto: UpdateUserAllergiesDto): Promise<{
        status: string;
        data: {
            allergies: {
                description: string | null;
                name: string;
            } | null;
            allergy_id: number | null;
        }[];
        message: string;
    }>;
    updateDiseases(userId: string, dto: UpdateUserDiseasesDto): Promise<{
        status: string;
        data: {
            diseases: {
                description: string | null;
                name: string;
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
            url: string;
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
}
