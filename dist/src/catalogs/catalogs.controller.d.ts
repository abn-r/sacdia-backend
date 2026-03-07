import { CatalogsService } from './catalogs.service';
export declare class CatalogsController {
    private readonly catalogsService;
    constructor(catalogsService: CatalogsService);
    getClubTypes(): Promise<{
        name: string;
        club_type_id: number;
    }[]>;
    getActivityTypes(): Promise<{
        name: string;
        description: string | null;
        code: string;
        activity_type_id: number;
    }[]>;
    getRelationshipTypes(): Promise<{
        name: string;
        description: string | null;
        relationship_type_id: string;
    }[]>;
    getCountries(): Promise<{
        name: string;
        country_id: number;
        abbreviation: string;
    }[]>;
    getUnions(countryId?: number): Promise<{
        name: string;
        country_id: number;
        union_id: number;
    }[]>;
    getLocalFields(unionId?: number): Promise<{
        name: string;
        union_id: number;
        local_field_id: number;
    }[]>;
    getDistricts(localFieldId?: number): Promise<{
        name: string;
        local_field_id: number;
        districlub_type_id: number;
    }[]>;
    getChurches(districtId?: number): Promise<{
        name: string;
        districlub_type_id: number;
        church_id: number;
    }[]>;
    getRoles(category?: string): Promise<{
        role_id: string;
        role_name: string;
        role_category: import("@prisma/client").$Enums.role_category;
    }[]>;
    getEcclesiasticalYears(): Promise<{
        active: boolean;
        start_date: Date;
        end_date: Date;
        year_id: number;
    }[]>;
    getCurrentEcclesiasticalYear(): Promise<{
        active: boolean;
        start_date: Date;
        end_date: Date;
        year_id: number;
    } | null>;
    getClubIdeals(clubTypeId?: number): Promise<{
        name: string;
        club_type_id: number;
        club_ideal_id: number;
        ideal_order: number;
        ideal: string | null;
    }[]>;
    getAllergies(): Promise<{
        name: string;
        description: string | null;
        allergy_id: number;
    }[]>;
    getDiseases(): Promise<{
        name: string;
        description: string | null;
        disease_id: number;
    }[]>;
}
