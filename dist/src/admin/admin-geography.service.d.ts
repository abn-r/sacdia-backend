import { PrismaService } from '../prisma/prisma.service';
import { CreateChurchDto, CreateCountryDto, CreateDistrictDto, CreateLocalFieldDto, CreateUnionDto, UpdateChurchDto, UpdateCountryDto, UpdateDistrictDto, UpdateLocalFieldDto, UpdateUnionDto } from './dto';
export declare class AdminGeographyService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    private normalizeName;
    private normalizeAbbreviation;
    private logMutation;
    listCountries(): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        abbreviation: string;
    }[]>;
    createCountry(dto: CreateCountryDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        abbreviation: string;
    }>;
    updateCountry(countryId: number, dto: UpdateCountryDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        abbreviation: string;
    }>;
    deleteCountry(countryId: number, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        abbreviation: string;
    }>;
    listUnions(countryId?: number): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        union_id: number;
        abbreviation: string;
    }[]>;
    createUnion(dto: CreateUnionDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        union_id: number;
        abbreviation: string;
    }>;
    updateUnion(unionId: number, dto: UpdateUnionDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        union_id: number;
        abbreviation: string;
    }>;
    deleteUnion(unionId: number, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        country_id: number;
        union_id: number;
        abbreviation: string;
    }>;
    listLocalFields(unionId?: number): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        union_id: number;
        local_field_id: number;
        abbreviation: string;
    }[]>;
    createLocalField(dto: CreateLocalFieldDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        union_id: number;
        local_field_id: number;
        abbreviation: string;
    }>;
    updateLocalField(localFieldId: number, dto: UpdateLocalFieldDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        union_id: number;
        local_field_id: number;
        abbreviation: string;
    }>;
    deleteLocalField(localFieldId: number, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        union_id: number;
        local_field_id: number;
        abbreviation: string;
    }>;
    listDistricts(localFieldId?: number): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        districlub_type_id: number;
    }[]>;
    createDistrict(dto: CreateDistrictDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        districlub_type_id: number;
    }>;
    updateDistrict(districtId: number, dto: UpdateDistrictDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        districlub_type_id: number;
    }>;
    deleteDistrict(districtId: number, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        local_field_id: number;
        districlub_type_id: number;
    }>;
    listChurches(districtId?: number): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        districlub_type_id: number;
        church_id: number;
    }[]>;
    createChurch(dto: CreateChurchDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        districlub_type_id: number;
        church_id: number;
    }>;
    updateChurch(churchId: number, dto: UpdateChurchDto, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        districlub_type_id: number;
        church_id: number;
    }>;
    deleteChurch(churchId: number, actorId: string): Promise<{
        created_at: Date | null;
        name: string;
        active: boolean;
        modified_at: Date | null;
        districlub_type_id: number;
        church_id: number;
    }>;
    private ensureCountryUnique;
    private ensureUnionUnique;
    private ensureLocalFieldUnique;
    private ensureCountryExists;
    private ensureUnionExists;
    private ensureLocalFieldExists;
    private ensureDistrictExists;
    private ensureChurchExists;
}
