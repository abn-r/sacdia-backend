import { PrismaService } from '../prisma/prisma.service';
import { CreateFinanceDto, UpdateFinanceDto, FinanceFiltersDto } from './dto';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
export declare class FinancesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getCategories(type?: number): Promise<{
        name: string;
        description: string | null;
        type: number;
        icon: number | null;
        finance_category_id: number;
    }[]>;
    findByClub(clubId: number, filters?: FinanceFiltersDto, pagination?: PaginationDto): Promise<PaginatedResult<any>>;
    getSummary(clubId: number, year?: number, month?: number): Promise<{
        club_id: number;
        period: string;
        total_income: number;
        total_expense: number;
        balance: number;
        movement_count: number;
    }>;
    findOne(financeId: number): Promise<{
        club_types: {
            name: string;
        };
        finances_categories: {
            name: string;
            active: boolean;
            created_at: Date | null;
            modified_at: Date | null;
            description: string | null;
            type: number;
            icon: number | null;
            finance_category_id: number;
        };
        users: {
            name: string | null;
            paternal_last_name: string | null;
        };
    } & {
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        year: number;
        created_by: string;
        finance_id: number;
        month: number;
        amount: number;
        finance_category_id: number;
        finance_date: Date;
    }>;
    create(dto: CreateFinanceDto, createdBy: string): Promise<{
        finances_categories: {
            name: string;
            type: number;
        };
    } & {
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        year: number;
        created_by: string;
        finance_id: number;
        month: number;
        amount: number;
        finance_category_id: number;
        finance_date: Date;
    }>;
    update(financeId: number, dto: UpdateFinanceDto): Promise<{
        finances_categories: {
            name: string;
            type: number;
        };
    } & {
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        year: number;
        created_by: string;
        finance_id: number;
        month: number;
        amount: number;
        finance_category_id: number;
        finance_date: Date;
    }>;
    remove(financeId: number): Promise<{
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        year: number;
        created_by: string;
        finance_id: number;
        month: number;
        amount: number;
        finance_category_id: number;
        finance_date: Date;
    }>;
}
