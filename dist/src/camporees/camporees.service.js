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
exports.CamporeesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const dto_utils_1 = require("../common/utils/dto.utils");
let CamporeesService = class CamporeesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(filters, pagination) {
        const where = {};
        if (filters?.active !== undefined) {
            where.active = filters.active;
        }
        const [data, total] = await Promise.all([
            this.prisma.local_camporees.findMany({
                where,
                include: {
                    local_fields: {
                        select: {
                            local_field_id: true,
                            name: true,
                            abbreviation: true,
                        },
                    },
                    ecclesiastical_year_relation: {
                        select: {
                            year_id: true,
                            start_date: true,
                            end_date: true,
                        },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip: pagination?.skip ?? 0,
                take: pagination?.take ?? 20,
            }),
            this.prisma.local_camporees.count({ where }),
        ]);
        return (0, pagination_dto_1.createPaginatedResult)(data, total, pagination ?? new pagination_dto_1.PaginationDto());
    }
    async findOne(camporeeId) {
        const camporee = await this.prisma.local_camporees.findUnique({
            where: { local_camporee_id: camporeeId },
            include: {
                local_fields: {
                    select: {
                        local_field_id: true,
                        name: true,
                        abbreviation: true,
                    },
                },
                ecclesiastical_year_relation: {
                    select: {
                        year_id: true,
                        start_date: true,
                        end_date: true,
                    },
                },
                attending_members_camporees: {
                    where: { active: true },
                    select: {
                        camporee_member_id: true,
                        user_id: true,
                        insurance_verified: true,
                    },
                },
            },
        });
        if (!camporee) {
            throw new common_1.NotFoundException(`Camporee with ID ${camporeeId} not found`);
        }
        return camporee;
    }
    async create(dto, createdBy) {
        const activeYear = await this.prisma.ecclesiastical_years.findFirst({
            where: { active: true },
            orderBy: { start_date: 'desc' },
        });
        if (!activeYear) {
            throw new common_1.BadRequestException('No active ecclesiastical year found. Please activate an ecclesiastical year first.');
        }
        const localField = await this.prisma.local_fields.findUnique({
            where: { local_field_id: dto.local_field_id },
        });
        if (!localField) {
            throw new common_1.BadRequestException(`Local field with ID ${dto.local_field_id} not found`);
        }
        return this.prisma.local_camporees.create({
            data: {
                name: dto.name,
                description: dto.description,
                start_date: new Date(dto.start_date),
                end_date: new Date(dto.end_date),
                local_field_id: dto.local_field_id,
                includes_adventurers: dto.includes_adventurers,
                includes_pathfinders: dto.includes_pathfinders,
                includes_master_guides: dto.includes_master_guides,
                local_camporee_place: dto.local_camporee_place,
                registration_cost: dto.registration_cost,
                ecclesiastical_year: activeYear.year_id,
                active: true,
            },
            include: {
                local_fields: {
                    select: {
                        local_field_id: true,
                        name: true,
                        abbreviation: true,
                    },
                },
                ecclesiastical_year_relation: {
                    select: {
                        year_id: true,
                        start_date: true,
                        end_date: true,
                    },
                },
            },
        });
    }
    async update(camporeeId, dto) {
        await this.findOne(camporeeId);
        const updateData = {
            ...(0, dto_utils_1.buildPartialUpdate)(dto, ['start_date', 'end_date']),
            modified_at: new Date(),
        };
        return this.prisma.local_camporees.update({
            where: { local_camporee_id: camporeeId },
            data: updateData,
            include: {
                local_fields: {
                    select: {
                        local_field_id: true,
                        name: true,
                        abbreviation: true,
                    },
                },
                ecclesiastical_year_relation: {
                    select: {
                        year_id: true,
                        start_date: true,
                        end_date: true,
                    },
                },
            },
        });
    }
    async remove(camporeeId) {
        await this.findOne(camporeeId);
        return this.prisma.local_camporees.update({
            where: { local_camporee_id: camporeeId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
    }
    async registerMember(camporeeId, dto) {
        return await this.prisma.$transaction(async (tx) => {
            const camporee = await tx.local_camporees.findUnique({
                where: { local_camporee_id: camporeeId },
            });
            if (!camporee) {
                throw new common_1.NotFoundException('Camporee not found');
            }
            if (!camporee.active) {
                throw new common_1.BadRequestException('Camporee is not active');
            }
            const user = await tx.users.findUnique({
                where: { user_id: dto.user_id },
            });
            if (!user) {
                throw new common_1.BadRequestException('User not found');
            }
            const existingRegistration = await tx.camporee_members.findFirst({
                where: {
                    camporee_id: camporeeId,
                    user_id: dto.user_id,
                    active: true,
                },
            });
            if (existingRegistration) {
                throw new common_1.BadRequestException('User is already registered for this camporee');
            }
            if (dto.insurance_id) {
                const insurance = await tx.member_insurances.findUnique({
                    where: { insurance_id: dto.insurance_id },
                });
                if (!insurance) {
                    throw new common_1.BadRequestException('Insurance not found');
                }
                if (insurance.user_id !== dto.user_id) {
                    throw new common_1.BadRequestException('Insurance does not belong to this user');
                }
                if (insurance.insurance_type !== 'CAMPOREE') {
                    throw new common_1.BadRequestException('Insurance type must be CAMPOREE');
                }
                if (insurance.end_date < camporee.end_date) {
                    throw new common_1.BadRequestException('Insurance expires before camporee ends');
                }
                if (!insurance.active) {
                    throw new common_1.BadRequestException('Insurance is not active');
                }
            }
            const member = await tx.camporee_members.create({
                data: {
                    camporee_id: camporeeId,
                    camporee_type: dto.camporee_type,
                    user_id: dto.user_id,
                    club_name: dto.club_name,
                    insurance_verified: !!dto.insurance_id,
                    insurance_id: dto.insurance_id,
                    active: true,
                },
                include: {
                    users: {
                        select: {
                            user_id: true,
                            name: true,
                            paternal_last_name: true,
                            maternal_last_name: true,
                            email: true,
                            user_image: true,
                        },
                    },
                    insurance: {
                        select: {
                            insurance_id: true,
                            insurance_type: true,
                            policy_number: true,
                            provider: true,
                            start_date: true,
                            end_date: true,
                        },
                    },
                },
            });
            return member;
        });
    }
    async getMembers(camporeeId) {
        await this.findOne(camporeeId);
        return await this.prisma.camporee_members.findMany({
            where: {
                camporee_id: camporeeId,
                active: true,
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        name: true,
                        paternal_last_name: true,
                        maternal_last_name: true,
                        email: true,
                        user_image: true,
                        birthday: true,
                    },
                },
                insurance: {
                    select: {
                        insurance_id: true,
                        insurance_type: true,
                        policy_number: true,
                        provider: true,
                        start_date: true,
                        end_date: true,
                    },
                },
            },
            orderBy: { created_at: 'asc' },
        });
    }
    async removeMember(camporeeId, userId) {
        await this.findOne(camporeeId);
        const registration = await this.prisma.camporee_members.findFirst({
            where: {
                camporee_id: camporeeId,
                user_id: userId,
                active: true,
            },
        });
        if (!registration) {
            throw new common_1.NotFoundException(`Member with user ID ${userId} not found in camporee ${camporeeId}`);
        }
        return await this.prisma.camporee_members.update({
            where: {
                camporee_member_id: registration.camporee_member_id,
            },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
    }
    async registerParticipants(camporeeId, dto, registeredBy) {
        return this.registerMember(camporeeId, dto);
    }
    async getParticipants(camporeeId, pagination) {
        const members = await this.getMembers(camporeeId);
        const skip = pagination?.skip ?? 0;
        const take = pagination?.take ?? 20;
        const paginatedMembers = members.slice(skip, skip + take);
        return (0, pagination_dto_1.createPaginatedResult)(paginatedMembers, members.length, pagination ?? new pagination_dto_1.PaginationDto());
    }
};
exports.CamporeesService = CamporeesService;
exports.CamporeesService = CamporeesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CamporeesService);
//# sourceMappingURL=camporees.service.js.map