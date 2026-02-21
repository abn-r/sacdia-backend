import { AdminGeographyService } from './admin-geography.service';
import { CreateChurchDto, CreateCountryDto, CreateDistrictDto, CreateLocalFieldDto, CreateUnionDto, UpdateChurchDto, UpdateCountryDto, UpdateDistrictDto, UpdateLocalFieldDto, UpdateUnionDto } from './dto';
export declare class AdminGeographyController {
    private readonly geographyService;
    constructor(geographyService: AdminGeographyService);
    listCountries(): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            abbreviation: string;
        }[];
    }>;
    createCountry(dto: CreateCountryDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            abbreviation: string;
        };
    }>;
    updateCountry(countryId: number, dto: UpdateCountryDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            abbreviation: string;
        };
    }>;
    deleteCountry(countryId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            abbreviation: string;
        };
    }>;
    listUnions(countryId?: number): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            union_id: number;
            abbreviation: string;
        }[];
    }>;
    createUnion(dto: CreateUnionDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            union_id: number;
            abbreviation: string;
        };
    }>;
    updateUnion(unionId: number, dto: UpdateUnionDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            union_id: number;
            abbreviation: string;
        };
    }>;
    deleteUnion(unionId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            country_id: number;
            union_id: number;
            abbreviation: string;
        };
    }>;
    listLocalFields(unionId?: number): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            union_id: number;
            local_field_id: number;
            abbreviation: string;
        }[];
    }>;
    createLocalField(dto: CreateLocalFieldDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            union_id: number;
            local_field_id: number;
            abbreviation: string;
        };
    }>;
    updateLocalField(localFieldId: number, dto: UpdateLocalFieldDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            union_id: number;
            local_field_id: number;
            abbreviation: string;
        };
    }>;
    deleteLocalField(localFieldId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            union_id: number;
            local_field_id: number;
            abbreviation: string;
        };
    }>;
    listDistricts(localFieldId?: number): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        }[];
    }>;
    createDistrict(dto: CreateDistrictDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        };
    }>;
    updateDistrict(districtId: number, dto: UpdateDistrictDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        };
    }>;
    deleteDistrict(districtId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            local_field_id: number;
            districlub_type_id: number;
        };
    }>;
    listChurches(districtId?: number): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        }[];
    }>;
    createChurch(dto: CreateChurchDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        };
    }>;
    updateChurch(churchId: number, dto: UpdateChurchDto, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        };
    }>;
    deleteChurch(churchId: number, req: any): Promise<{
        status: string;
        data: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            districlub_type_id: number;
            church_id: number;
        };
    }>;
}
