import { AdminReferenceService } from './admin-reference.service';
import { CreateAllergyDto, CreateDiseaseDto, CreateEcclesiasticalYearDto, CreateMedicineDto, CreateRelationshipTypeDto, UpdateAllergyDto, UpdateDiseaseDto, UpdateEcclesiasticalYearDto, UpdateMedicineDto, UpdateRelationshipTypeDto } from './dto';
export declare class AdminReferenceController {
    private readonly referenceService;
    constructor(referenceService: AdminReferenceService);
    private getActorId;
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
    createRelationshipType(dto: CreateRelationshipTypeDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    updateRelationshipType(relationshipTypeId: string, dto: UpdateRelationshipTypeDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    deleteRelationshipType(relationshipTypeId: string, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    createAllergy(dto: CreateAllergyDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    updateAllergy(allergyId: number, dto: UpdateAllergyDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    deleteAllergy(allergyId: number, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    createDisease(dto: CreateDiseaseDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    updateDisease(diseaseId: number, dto: UpdateDiseaseDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    deleteDisease(diseaseId: number, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
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
    listMedicines(): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            medicine_id: number;
        }[];
    }>;
    createMedicine(dto: CreateMedicineDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            medicine_id: number;
        };
    }>;
    updateMedicine(medicineId: number, dto: UpdateMedicineDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            medicine_id: number;
        };
    }>;
    deleteMedicine(medicineId: number, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date;
            modified_at: Date;
            description: string | null;
            medicine_id: number;
        };
    }>;
    listEcclesiasticalYears(): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            start_date: Date;
            end_date: Date;
            year_id: number;
        }[];
    }>;
    createEcclesiasticalYear(dto: CreateEcclesiasticalYearDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    }>;
    updateEcclesiasticalYear(yearId: number, dto: UpdateEcclesiasticalYearDto, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    }>;
    deleteEcclesiasticalYear(yearId: number, req: Request & {
        user: {
            sub: string;
        };
    }): Promise<{
        status: string;
        data: {
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            start_date: Date;
            end_date: Date;
            year_id: number;
        };
    }>;
}
