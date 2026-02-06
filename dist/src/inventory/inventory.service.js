"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let InventoryService = class InventoryService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAllByClub(clubId, instanceType, categoryId) {
        const whereClause = this.buildWhereClause(clubId, instanceType, categoryId);
        const items = await this.prisma.club_inventory.findMany({
            where: whereClause,
            orderBy: [{ inventory_category_id: 'asc' }, { name: 'asc' }],
        });
        const categoryIds = [
            ...new Set(items.map((i) => i.inventory_category_id).filter(Boolean)),
        ];
        const categories = await this.prisma.inventory_categories.findMany({
            where: { inventory_category_id: { in: categoryIds } },
        });
        const categoryMap = new Map(categories.map((c) => [c.inventory_category_id, c]));
        return {
            data: items.map((item) => {
                const category = item.inventory_category_id
                    ? categoryMap.get(item.inventory_category_id)
                    : null;
                return {
                    inventory_id: item.club_inventory_id,
                    name: item.name,
                    description: item.description,
                    inventory_category_id: item.inventory_category_id,
                    category: category
                        ? {
                            category_id: category.inventory_category_id,
                            name: category.name,
                        }
                        : null,
                    amount: item.amount,
                    club_adv_id: item.club_adv_id,
                    club_pathf_id: item.club_pathf_id,
                    club_mg_id: item.club_mg_id,
                    active: item.active,
                    created_at: item.created_at,
                    updated_at: item.modified_at,
                };
            }),
            meta: {
                total_items: items.length,
                total_value_estimated: null,
                club_instance: {
                    [`club_${instanceType}_id`]: clubId,
                    instance_type: instanceType,
                },
            },
        };
    }
    buildWhereClause(clubId, instanceType, categoryId) {
        const baseWhere = {
            active: true,
            ...(categoryId && { inventory_category_id: categoryId }),
        };
        switch (instanceType) {
            case 'adv':
                return { ...baseWhere, club_adv_id: clubId };
            case 'pathf':
                return { ...baseWhere, club_pathf_id: clubId };
            case 'mg':
                return { ...baseWhere, club_mg_id: clubId };
            default:
                throw new common_1.BadRequestException('Invalid instance type');
        }
    }
    async findOne(inventoryId) {
        const item = await this.prisma.club_inventory.findUnique({
            where: { club_inventory_id: inventoryId },
        });
        if (!item) {
            throw new common_1.NotFoundException(`Inventory item with ID ${inventoryId} not found`);
        }
        let category = null;
        if (item.inventory_category_id) {
            const cat = await this.prisma.inventory_categories.findUnique({
                where: { inventory_category_id: item.inventory_category_id },
            });
            if (cat) {
                category = {
                    category_id: cat.inventory_category_id,
                    name: cat.name,
                    description: null,
                };
            }
        }
        return {
            inventory_id: item.club_inventory_id,
            name: item.name,
            description: item.description,
            inventory_category_id: item.inventory_category_id,
            category,
            amount: item.amount,
            club_adv_id: item.club_adv_id,
            club_pathf_id: item.club_pathf_id,
            club_mg_id: item.club_mg_id,
            active: item.active,
            created_at: item.created_at,
            updated_at: item.modified_at,
            history: [],
        };
    }
    async create(clubId, dto) {
        const category = await this.prisma.inventory_categories.findUnique({
            where: { inventory_category_id: dto.inventory_category_id },
        });
        if (!category || !category.active) {
            throw new common_1.NotFoundException('Inventory category not found');
        }
        await this.validateClubExists(clubId, dto.instanceType);
        const clubFields = this.getClubFields(clubId, dto.instanceType);
        const item = await this.prisma.club_inventory.create({
            data: {
                name: dto.name,
                description: dto.description,
                inventory_category_id: dto.inventory_category_id,
                amount: dto.amount,
                ...clubFields,
                active: true,
            },
        });
        return {
            inventory_id: item.club_inventory_id,
            name: item.name,
            description: item.description,
            inventory_category_id: item.inventory_category_id,
            category: {
                category_id: category.inventory_category_id,
                name: category.name,
            },
            amount: item.amount,
            club_adv_id: item.club_adv_id,
            club_pathf_id: item.club_pathf_id,
            club_mg_id: item.club_mg_id,
            active: item.active,
            created_at: item.created_at,
            updated_at: item.modified_at,
        };
    }
    async validateClubExists(clubId, instanceType) {
        let clubExists = false;
        switch (instanceType) {
            case 'adv':
                clubExists = !!(await this.prisma.club_adventurers.findUnique({
                    where: { club_adv_id: clubId },
                }));
                break;
            case 'pathf':
                clubExists = !!(await this.prisma.club_pathfinders.findUnique({
                    where: { club_pathf_id: clubId },
                }));
                break;
            case 'mg':
                clubExists = !!(await this.prisma.club_master_guilds.findUnique({
                    where: { club_mg_id: clubId },
                }));
                break;
        }
        if (!clubExists) {
            throw new common_1.NotFoundException(`Club not found for instance type ${instanceType}`);
        }
    }
    getClubFields(clubId, instanceType) {
        switch (instanceType) {
            case 'adv':
                return { club_adv_id: clubId, club_pathf_id: null, club_mg_id: null };
            case 'pathf':
                return { club_adv_id: null, club_pathf_id: clubId, club_mg_id: null };
            case 'mg':
                return { club_adv_id: null, club_pathf_id: null, club_mg_id: clubId };
            default:
                throw new common_1.BadRequestException('Invalid instance type');
        }
    }
    async update(inventoryId, dto) {
        const existingItem = await this.prisma.club_inventory.findUnique({
            where: { club_inventory_id: inventoryId },
        });
        if (!existingItem) {
            throw new common_1.NotFoundException(`Inventory item with ID ${inventoryId} not found`);
        }
        if (dto.inventory_category_id) {
            const category = await this.prisma.inventory_categories.findUnique({
                where: { inventory_category_id: dto.inventory_category_id },
            });
            if (!category || !category.active) {
                throw new common_1.NotFoundException('Inventory category not found');
            }
        }
        const item = await this.prisma.club_inventory.update({
            where: { club_inventory_id: inventoryId },
            data: {
                ...(dto.name && { name: dto.name }),
                ...(dto.description !== undefined && { description: dto.description }),
                ...(dto.inventory_category_id && {
                    inventory_category_id: dto.inventory_category_id,
                }),
                ...(dto.amount !== undefined && { amount: dto.amount }),
            },
        });
        let category = null;
        if (item.inventory_category_id) {
            const cat = await this.prisma.inventory_categories.findUnique({
                where: { inventory_category_id: item.inventory_category_id },
            });
            if (cat) {
                category = {
                    category_id: cat.inventory_category_id,
                    name: cat.name,
                };
            }
        }
        return {
            inventory_id: item.club_inventory_id,
            name: item.name,
            description: item.description,
            inventory_category_id: item.inventory_category_id,
            category,
            amount: item.amount,
            club_adv_id: item.club_adv_id,
            club_pathf_id: item.club_pathf_id,
            club_mg_id: item.club_mg_id,
            active: item.active,
            created_at: item.created_at,
            updated_at: item.modified_at,
        };
    }
    async delete(inventoryId) {
        const item = await this.prisma.club_inventory.findUnique({
            where: { club_inventory_id: inventoryId },
        });
        if (!item) {
            throw new common_1.NotFoundException(`Inventory item with ID ${inventoryId} not found`);
        }
        await this.prisma.club_inventory.update({
            where: { club_inventory_id: inventoryId },
            data: { active: false },
        });
        return {
            message: 'Inventory item deleted successfully',
        };
    }
    async findAllCategories() {
        const categories = await this.prisma.inventory_categories.findMany({
            where: { active: true },
            orderBy: { name: 'asc' },
        });
        return categories;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map