import { AdminReferenceService } from './admin-reference.service';
import { CreateAllergyDto, CreateDiseaseDto, CreateEcclesiasticalYearDto, CreateRelationshipTypeDto, UpdateAllergyDto, UpdateDiseaseDto, UpdateEcclesiasticalYearDto, UpdateRelationshipTypeDto } from './dto';
export declare class AdminReferenceController {
    private readonly referenceService;
    constructor(referenceService: AdminReferenceService);
    listRelationshipTypes(): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            relationship_type_id: string;
        }[];
    }>;
    createRelationshipType(dto: CreateRelationshipTypeDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            relationship_type_id: string;
        };
    }>;
    updateRelationshipType(relationshipTypeId: string, dto: UpdateRelationshipTypeDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            relationship_type_id: string;
        };
    }>;
    deleteRelationshipType(relationshipTypeId: string, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            relationship_type_id: string;
        };
    }>;
    listAllergies(): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            allergy_id: number;
        }[];
    }>;
    createAllergy(dto: CreateAllergyDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            allergy_id: number;
        };
    }>;
    updateAllergy(allergyId: number, dto: UpdateAllergyDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            allergy_id: number;
        };
    }>;
    deleteAllergy(allergyId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            allergy_id: number;
        };
    }>;
    listDiseases(): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            disease_id: number;
        }[];
    }>;
    createDisease(dto: CreateDiseaseDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            disease_id: number;
        };
    }>;
    updateDisease(diseaseId: number, dto: UpdateDiseaseDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            disease_id: number;
        };
    }>;
    deleteDisease(diseaseId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            disease_id: number;
        };
    }>;
    listEcclesiasticalYears(): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            year_id: number;
            start_date: Date;
            end_date: Date;
        }[];
    }>;
    createEcclesiasticalYear(dto: CreateEcclesiasticalYearDto, req: any): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            year_id: number;
            start_date: Date;
            end_date: Date;
        };
    }>;
    updateEcclesiasticalYear(yearId: number, dto: UpdateEcclesiasticalYearDto, req: any): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            year_id: number;
            start_date: Date;
            end_date: Date;
        };
    }>;
    deleteEcclesiasticalYear(yearId: number, req: any): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            year_id: number;
            start_date: Date;
            end_date: Date;
        };
    }>;
}
