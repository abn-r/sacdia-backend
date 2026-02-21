import { PrismaService } from '../prisma/prisma.service';
import { CreateAllergyDto, CreateDiseaseDto, CreateEcclesiasticalYearDto, CreateRelationshipTypeDto, UpdateAllergyDto, UpdateDiseaseDto, UpdateEcclesiasticalYearDto, UpdateRelationshipTypeDto } from './dto';
export declare class AdminReferenceService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    private normalizeName;
    private logMutation;
    listRelationshipTypes(): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        relationship_type_id: string;
    }[]>;
    createRelationshipType(dto: CreateRelationshipTypeDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        relationship_type_id: string;
    }>;
    updateRelationshipType(relationshipTypeId: string, dto: UpdateRelationshipTypeDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        relationship_type_id: string;
    }>;
    deleteRelationshipType(relationshipTypeId: string, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        relationship_type_id: string;
    }>;
    listAllergies(): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        allergy_id: number;
    }[]>;
    createAllergy(dto: CreateAllergyDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        allergy_id: number;
    }>;
    updateAllergy(allergyId: number, dto: UpdateAllergyDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        allergy_id: number;
    }>;
    deleteAllergy(allergyId: number, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        allergy_id: number;
    }>;
    listDiseases(): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        disease_id: number;
    }[]>;
    createDisease(dto: CreateDiseaseDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        disease_id: number;
    }>;
    updateDisease(diseaseId: number, dto: UpdateDiseaseDto, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        disease_id: number;
    }>;
    deleteDisease(diseaseId: number, actorId: string): Promise<{
        name: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        description: string | null;
        disease_id: number;
    }>;
    listEcclesiasticalYears(): Promise<{
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        year_id: number;
        start_date: Date;
        end_date: Date;
    }[]>;
    createEcclesiasticalYear(dto: CreateEcclesiasticalYearDto, actorId: string): Promise<{
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        year_id: number;
        start_date: Date;
        end_date: Date;
    }>;
    updateEcclesiasticalYear(yearId: number, dto: UpdateEcclesiasticalYearDto, actorId: string): Promise<{
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        year_id: number;
        start_date: Date;
        end_date: Date;
    }>;
    deleteEcclesiasticalYear(yearId: number, actorId: string): Promise<{
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        year_id: number;
        start_date: Date;
        end_date: Date;
    }>;
    private validateDateRange;
    private ensureRelationshipTypeExists;
    private ensureRelationshipTypeUnique;
    private ensureAllergyExists;
    private ensureAllergyUnique;
    private ensureDiseaseExists;
    private ensureDiseaseUnique;
    private ensureEcclesiasticalYearExists;
}
