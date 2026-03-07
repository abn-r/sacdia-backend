import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
export declare class InventoryService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAllByClub(clubId: number, instanceType: 'adv' | 'pathf' | 'mg', categoryId?: number): Promise<{
        data: {
            inventory_id: number;
            name: string;
            description: string | null;
            inventory_category_id: number | null;
            category: {
                category_id: number;
                name: string;
            } | null;
            amount: number | null;
            club_adv_id: number | null;
            club_pathf_id: number | null;
            club_mg_id: number | null;
            active: boolean;
            created_at: Date | null;
            updated_at: Date | null;
        }[];
        meta: {
            total_items: number;
            total_value_estimated: null;
            club_instance: {
                [x: string]: number | "pathf" | "adv" | "mg";
                instance_type: "pathf" | "adv" | "mg";
            };
        };
    }>;
    private buildWhereClause;
    findOne(inventoryId: number): Promise<{
        inventory_id: number;
        name: string;
        description: string | null;
        inventory_category_id: number | null;
        category: {
            category_id: number;
            name: string;
            description: null;
        } | null;
        amount: number | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        active: boolean;
        created_at: Date | null;
        updated_at: Date | null;
        history: never[];
    }>;
    create(clubId: number, dto: CreateItemDto): Promise<{
        inventory_id: number;
        name: string;
        description: string | null;
        inventory_category_id: number | null;
        category: {
            category_id: number;
            name: string;
        };
        amount: number | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        active: boolean;
        created_at: Date | null;
        updated_at: Date | null;
    }>;
    private validateClubExists;
    private getClubFields;
    update(inventoryId: number, dto: UpdateItemDto): Promise<{
        inventory_id: number;
        name: string;
        description: string | null;
        inventory_category_id: number | null;
        category: {
            category_id: number;
            name: string;
        } | null;
        amount: number | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        active: boolean;
        created_at: Date | null;
        updated_at: Date | null;
    }>;
    delete(inventoryId: number): Promise<{
        message: string;
    }>;
    findAllCategories(): Promise<{
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        icon: number | null;
        inventory_category_id: number;
    }[]>;
}
