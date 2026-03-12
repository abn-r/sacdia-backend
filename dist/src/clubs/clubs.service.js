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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ClubsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClubsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const dto_1 = require("./dto");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const file_storage_service_1 = require("../common/services/file-storage.service");
let ClubsService = class ClubsService {
    static { ClubsService_1 = this; }
    prisma;
    fileStorage;
    logger = new common_1.Logger(ClubsService_1.name);
    static PRIVATE_ASSET_URL_TTL_SECONDS = 300;
    constructor(prisma, fileStorage) {
        this.prisma = prisma;
        this.fileStorage = fileStorage;
    }
    async findAll(filters, pagination) {
        const where = {
            ...(filters?.localFieldId && { local_field_id: filters.localFieldId }),
            ...(filters?.districtId && {
                districlub_type_id: filters.districtId,
            }),
            ...(filters?.churchId && { church_id: filters.churchId }),
            ...(filters?.active !== undefined && { active: filters.active }),
        };
        const [data, total] = await Promise.all([
            this.prisma.clubs.findMany({
                where,
                include: {
                    churches: { select: { name: true } },
                    districts: { select: { name: true } },
                    local_fields: { select: { name: true } },
                    club_adventurers: { select: { club_adv_id: true, active: true } },
                    club_pathfinders: { select: { club_pathf_id: true, active: true } },
                    club_master_guild: { select: { club_mg_id: true, active: true } },
                },
                orderBy: { name: 'asc' },
                skip: pagination?.skip ?? 0,
                take: pagination?.take ?? 20,
            }),
            this.prisma.clubs.count({ where }),
        ]);
        return (0, pagination_dto_1.createPaginatedResult)(data, total, pagination ?? new pagination_dto_1.PaginationDto());
    }
    async findOne(clubId) {
        const club = await this.prisma.clubs.findUnique({
            where: { club_id: clubId },
            include: {
                churches: true,
                districts: true,
                local_fields: true,
                club_adventurers: true,
                club_pathfinders: true,
                club_master_guild: true,
            },
        });
        if (!club) {
            throw new common_1.NotFoundException(`Club with ID ${clubId} not found`);
        }
        return club;
    }
    async create(dto) {
        return this.prisma.clubs.create({
            data: {
                name: dto.name,
                description: dto.description,
                local_field_id: dto.local_field_id,
                districlub_type_id: dto.districlub_type_id,
                church_id: dto.church_id,
                address: dto.address,
                coordinates: dto.coordinates || { lat: 0, lng: 0 },
                active: true,
            },
        });
    }
    async update(clubId, dto) {
        await this.findOne(clubId);
        return this.prisma.clubs.update({
            where: { club_id: clubId },
            data: {
                ...dto,
                modified_at: new Date(),
            },
        });
    }
    async remove(clubId) {
        await this.findOne(clubId);
        return this.prisma.clubs.update({
            where: { club_id: clubId },
            data: { active: false, modified_at: new Date() },
        });
    }
    async getInstances(clubId) {
        await this.findOne(clubId);
        const [adventurers, pathfinders, masterGuilds] = await Promise.all([
            this.prisma.club_adventurers.findMany({
                where: { main_club_id: clubId },
                include: {
                    club_types: {
                        select: {
                            name: true,
                        },
                    },
                },
                orderBy: { club_adv_id: 'asc' },
            }),
            this.prisma.club_pathfinders.findMany({
                where: { main_club_id: clubId },
                include: {
                    club_types: {
                        select: {
                            name: true,
                        },
                    },
                },
                orderBy: { club_pathf_id: 'asc' },
            }),
            this.prisma.club_master_guilds.findMany({
                where: { main_club_id: clubId },
                include: {
                    club_types: {
                        select: {
                            name: true,
                        },
                    },
                },
                orderBy: { club_mg_id: 'asc' },
            }),
        ]);
        return {
            adventurers: adventurers.map(({ club_types, ...instance }) => ({
                ...instance,
                club_type_name: club_types?.name ?? null,
            })),
            pathfinders: pathfinders.map(({ club_types, ...instance }) => ({
                ...instance,
                club_type_name: club_types?.name ?? null,
            })),
            master_guilds: masterGuilds.map(({ club_types, ...instance }) => ({
                ...instance,
                club_type_name: club_types?.name ?? null,
            })),
        };
    }
    async getInstance(clubId, type) {
        const club = await this.findOne(clubId);
        switch (type) {
            case dto_1.ClubInstanceType.ADVENTURERS:
                return club.club_adventurers;
            case dto_1.ClubInstanceType.PATHFINDERS:
                return club.club_pathfinders;
            case dto_1.ClubInstanceType.MASTER_GUILDS:
                return club.club_master_guild;
            default:
                throw new common_1.BadRequestException(`Invalid instance type: ${type}`);
        }
    }
    async createInstance(clubId, dto) {
        await this.findOne(clubId);
        const clubType = await this.prisma.club_types.findFirst({
            where: {
                name: this.getClubTypeName(dto.type),
                active: true,
            },
        });
        if (!clubType) {
            throw new common_1.BadRequestException(`Club type for ${dto.type} not found in catalog`);
        }
        const meetingDay = (dto.meeting_day || []);
        const meetingTime = (dto.meeting_time || []);
        switch (dto.type) {
            case dto_1.ClubInstanceType.ADVENTURERS:
                return this.prisma.club_adventurers.create({
                    data: {
                        main_club_id: clubId,
                        club_type_id: clubType.club_type_id,
                        souls_target: dto.souls_target || 1,
                        fee: dto.fee || 0,
                        meeting_day: meetingDay,
                        meeting_time: meetingTime,
                        active: true,
                    },
                });
            case dto_1.ClubInstanceType.PATHFINDERS:
                return this.prisma.club_pathfinders.create({
                    data: {
                        main_club_id: clubId,
                        club_type_id: clubType.club_type_id,
                        souls_target: dto.souls_target || 1,
                        fee: dto.fee || 0,
                        meeting_day: meetingDay,
                        meeting_time: meetingTime,
                        active: true,
                    },
                });
            case dto_1.ClubInstanceType.MASTER_GUILDS:
                return this.prisma.club_master_guilds.create({
                    data: {
                        main_club_id: clubId,
                        club_type_id: clubType.club_type_id,
                        souls_target: dto.souls_target || 1,
                        fee: dto.fee || 0,
                        meeting_day: meetingDay,
                        meeting_time: meetingTime,
                        active: true,
                    },
                });
            default:
                throw new common_1.BadRequestException(`Invalid instance type: ${dto.type}`);
        }
    }
    async updateInstance(instanceId, type, dto) {
        const updateData = {
            modified_at: new Date(),
        };
        if (dto.souls_target !== undefined)
            updateData.souls_target = dto.souls_target;
        if (dto.fee !== undefined)
            updateData.fee = dto.fee;
        if (dto.active !== undefined)
            updateData.active = dto.active;
        if (dto.meeting_day)
            updateData.meeting_day = dto.meeting_day;
        if (dto.meeting_time)
            updateData.meeting_time = dto.meeting_time;
        switch (type) {
            case dto_1.ClubInstanceType.ADVENTURERS:
                return this.prisma.club_adventurers.update({
                    where: { club_adv_id: instanceId },
                    data: updateData,
                });
            case dto_1.ClubInstanceType.PATHFINDERS:
                return this.prisma.club_pathfinders.update({
                    where: { club_pathf_id: instanceId },
                    data: updateData,
                });
            case dto_1.ClubInstanceType.MASTER_GUILDS:
                return this.prisma.club_master_guilds.update({
                    where: { club_mg_id: instanceId },
                    data: updateData,
                });
            default:
                throw new common_1.BadRequestException(`Invalid instance type: ${type}`);
        }
    }
    async getMembers(instanceId, type) {
        const whereClause = this.getInstanceWhereClause(instanceId, type);
        const members = await this.prisma.club_role_assignments.findMany({
            where: {
                ...whereClause,
                active: true,
            },
            include: {
                users: {
                    select: {
                        user_id: true,
                        name: true,
                        paternal_last_name: true,
                        maternal_last_name: true,
                        user_image: true,
                    },
                },
                roles: {
                    select: {
                        role_id: true,
                        role_name: true,
                        role_category: true,
                    },
                },
            },
            orderBy: { start_date: 'desc' },
        });
        return Promise.all(members.map(async (member) => ({
            ...member,
            users: member.users
                ? {
                    ...member.users,
                    user_image: typeof member.users.user_image === 'string'
                        ? await this.resolvePrivateProfileUrl(member.users.user_image)
                        : member.users.user_image,
                }
                : member.users,
        })));
    }
    async assignRole(dto) {
        if (!dto.instance_type || !dto.instance_id) {
            throw new common_1.BadRequestException('instance_type and instance_id are required');
        }
        const roleId = await this.resolveRoleId(dto);
        const ecclesiasticalYearId = dto.ecclesiastical_year_id ?? (await this.getActiveEcclesiasticalYearId());
        const startDate = dto.start_date ?? new Date();
        const assignment = {
            user_id: dto.user_id,
            role_id: roleId,
            ecclesiastical_year_id: ecclesiasticalYearId,
            start_date: startDate,
            end_date: dto.end_date,
            active: true,
            status: 'active',
            club_adv_id: dto.instance_type === dto_1.ClubInstanceType.ADVENTURERS
                ? dto.instance_id
                : null,
            club_pathf_id: dto.instance_type === dto_1.ClubInstanceType.PATHFINDERS
                ? dto.instance_id
                : null,
            club_mg_id: dto.instance_type === dto_1.ClubInstanceType.MASTER_GUILDS
                ? dto.instance_id
                : null,
        };
        return this.prisma.club_role_assignments.create({
            data: assignment,
            include: {
                users: { select: { name: true, paternal_last_name: true } },
                roles: { select: { role_name: true } },
            },
        });
    }
    async updateRoleAssignment(assignmentId, dto) {
        const updateData = {
            modified_at: new Date(),
        };
        if (dto.role_id || dto.role) {
            updateData.role_id = await this.resolveRoleId(dto);
        }
        if (dto.ecclesiastical_year_id !== undefined) {
            updateData.ecclesiastical_year_id = dto.ecclesiastical_year_id;
        }
        if (dto.start_date !== undefined) {
            updateData.start_date = dto.start_date;
        }
        if (dto.end_date !== undefined) {
            updateData.end_date = dto.end_date;
        }
        if (dto.status !== undefined) {
            updateData.status = dto.status;
        }
        return this.prisma.club_role_assignments.update({
            where: { assignment_id: assignmentId },
            data: updateData,
        });
    }
    async removeRoleAssignment(assignmentId) {
        return this.prisma.club_role_assignments.update({
            where: { assignment_id: assignmentId },
            data: {
                active: false,
                status: 'ended',
                end_date: new Date(),
                modified_at: new Date(),
            },
        });
    }
    getClubTypeName(type) {
        switch (type) {
            case dto_1.ClubInstanceType.ADVENTURERS:
                return 'Aventureros';
            case dto_1.ClubInstanceType.PATHFINDERS:
                return 'Conquistadores';
            case dto_1.ClubInstanceType.MASTER_GUILDS:
                return 'Guías Mayores';
            default:
                return '';
        }
    }
    getInstanceWhereClause(instanceId, type) {
        switch (type) {
            case dto_1.ClubInstanceType.ADVENTURERS:
                return { club_adv_id: instanceId };
            case dto_1.ClubInstanceType.PATHFINDERS:
                return { club_pathf_id: instanceId };
            case dto_1.ClubInstanceType.MASTER_GUILDS:
                return { club_mg_id: instanceId };
            default:
                throw new common_1.BadRequestException(`Invalid instance type: ${type}`);
        }
    }
    async getActiveEcclesiasticalYearId() {
        const currentYear = await this.prisma.ecclesiastical_years.findFirst({
            where: {
                start_date: { lte: new Date() },
                end_date: { gte: new Date() },
            },
            select: { year_id: true },
        });
        if (!currentYear) {
            throw new common_1.BadRequestException('No active ecclesiastical year configured');
        }
        return currentYear.year_id;
    }
    async resolveRoleId(dto) {
        if (dto.role_id) {
            return dto.role_id;
        }
        if (!dto.role) {
            throw new common_1.BadRequestException('role_id or role is required');
        }
        const normalizedRoleName = dto.role.trim().toLowerCase();
        if (!normalizedRoleName) {
            throw new common_1.BadRequestException('role is empty');
        }
        const role = await this.prisma.roles.findFirst({
            where: {
                role_name: normalizedRoleName,
                role_category: 'CLUB',
                active: true,
            },
            select: { role_id: true },
        });
        if (!role) {
            throw new common_1.BadRequestException(`Role "${normalizedRoleName}" not found in CLUB category`);
        }
        return role.role_id;
    }
    async resolvePrivateProfileUrl(value) {
        if (!value)
            return null;
        try {
            return await this.fileStorage.getSignedDownloadUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, value, {
                expiresInSeconds: ClubsService_1.PRIVATE_ASSET_URL_TTL_SECONDS,
            });
        }
        catch (error) {
            this.logger.warn('Failed to generate signed URL for club member profile. Returning original value.', error);
            return value;
        }
    }
};
exports.ClubsService = ClubsService;
exports.ClubsService = ClubsService = ClubsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(file_storage_service_1.FILE_STORAGE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], ClubsService);
//# sourceMappingURL=clubs.service.js.map