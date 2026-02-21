import { LegalRepresentativesService } from './legal-representatives.service';
import { CreateLegalRepresentativeDto } from './dto/create-legal-representative.dto';
import { UpdateLegalRepresentativeDto } from './dto/update-legal-representative.dto';
export declare class LegalRepresentativesController {
    private readonly legalRepresentativesService;
    constructor(legalRepresentativesService: LegalRepresentativesService);
    create(userId: string, createDto: CreateLegalRepresentativeDto): Promise<{
        status: string;
        data: {
            relationship_types: {
                name: string;
            } | null;
        } & {
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            created_at: Date;
            modified_at: Date;
            id: string;
            representative_user_id: string | null;
            phone: string | null;
            relationship_type_id: string | null;
        };
        message: string;
    }>;
    findOne(userId: string): Promise<{
        status: string;
        data: null;
        hasLegalRepresentative: boolean;
        message: string;
    } | {
        status: string;
        data: {
            relationship_types: {
                name: string;
                relationship_type_id: string;
            } | null;
            representative_user: {
                user_id: string;
                email: string;
                name: string | null;
                paternal_last_name: string | null;
                maternal_last_name: string | null;
            } | null;
        } & {
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            created_at: Date;
            modified_at: Date;
            id: string;
            representative_user_id: string | null;
            phone: string | null;
            relationship_type_id: string | null;
        };
        hasLegalRepresentative: boolean;
        message?: undefined;
    }>;
    update(userId: string, updateDto: UpdateLegalRepresentativeDto): Promise<{
        status: string;
        data: {
            relationship_types: {
                name: string;
            } | null;
        } & {
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            created_at: Date;
            modified_at: Date;
            id: string;
            representative_user_id: string | null;
            phone: string | null;
            relationship_type_id: string | null;
        };
        message: string;
    }>;
    remove(userId: string): Promise<{
        status: string;
        message: string;
    }>;
}
