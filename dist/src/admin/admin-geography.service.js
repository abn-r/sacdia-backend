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
var AdminGeographyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGeographyService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AdminGeographyService = AdminGeographyService_1 = class AdminGeographyService {
    prisma;
    logger = new common_1.Logger(AdminGeographyService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    normalizeName(value) {
        return value.trim().replace(/\s+/g, ' ');
    }
    normalizeAbbreviation(value) {
        return value.trim().toUpperCase();
    }
    logMutation(action, resource, resourceId, actorId) {
        this.logger.log(JSON.stringify({
            action,
            resource,
            resourceId,
            actorId,
            timestamp: new Date().toISOString(),
        }));
    }
    async listCountries() {
        return this.prisma.countries.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async createCountry(dto, actorId) {
        const name = this.normalizeName(dto.name);
        const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
        await this.ensureCountryUnique(name, abbreviation);
        const country = await this.prisma.countries.create({
            data: {
                name,
                abbreviation,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'countries', country.country_id, actorId);
        return country;
    }
    async updateCountry(countryId, dto, actorId) {
        await this.ensureCountryExists(countryId);
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        const abbreviation = dto.abbreviation
            ? this.normalizeAbbreviation(dto.abbreviation)
            : undefined;
        if (name || abbreviation) {
            await this.ensureCountryUnique(name, abbreviation, countryId);
        }
        const country = await this.prisma.countries.update({
            where: { country_id: countryId },
            data: {
                ...(name ? { name } : {}),
                ...(abbreviation ? { abbreviation } : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'countries', countryId, actorId);
        return country;
    }
    async deleteCountry(countryId, actorId) {
        await this.ensureCountryExists(countryId);
        const activeUnions = await this.prisma.unions.count({
            where: {
                country_id: countryId,
                active: true,
            },
        });
        if (activeUnions > 0) {
            throw new common_1.ConflictException('Cannot deactivate country with active unions');
        }
        const country = await this.prisma.countries.update({
            where: { country_id: countryId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'countries', countryId, actorId);
        return country;
    }
    async listUnions(countryId) {
        return this.prisma.unions.findMany({
            where: countryId ? { country_id: countryId } : undefined,
            orderBy: { name: 'asc' },
        });
    }
    async createUnion(dto, actorId) {
        await this.ensureCountryExists(dto.country_id);
        const name = this.normalizeName(dto.name);
        const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
        await this.ensureUnionUnique(name, abbreviation);
        const union = await this.prisma.unions.create({
            data: {
                name,
                abbreviation,
                country_id: dto.country_id,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'unions', union.union_id, actorId);
        return union;
    }
    async updateUnion(unionId, dto, actorId) {
        await this.ensureUnionExists(unionId);
        if (dto.country_id) {
            await this.ensureCountryExists(dto.country_id);
        }
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        const abbreviation = dto.abbreviation
            ? this.normalizeAbbreviation(dto.abbreviation)
            : undefined;
        if (name || abbreviation) {
            await this.ensureUnionUnique(name, abbreviation, unionId);
        }
        const union = await this.prisma.unions.update({
            where: { union_id: unionId },
            data: {
                ...(name ? { name } : {}),
                ...(abbreviation ? { abbreviation } : {}),
                ...(dto.country_id ? { country_id: dto.country_id } : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'unions', unionId, actorId);
        return union;
    }
    async deleteUnion(unionId, actorId) {
        await this.ensureUnionExists(unionId);
        const activeLocalFields = await this.prisma.local_fields.count({
            where: {
                union_id: unionId,
                active: true,
            },
        });
        if (activeLocalFields > 0) {
            throw new common_1.ConflictException('Cannot deactivate union with active local fields');
        }
        const union = await this.prisma.unions.update({
            where: { union_id: unionId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'unions', unionId, actorId);
        return union;
    }
    async listLocalFields(unionId) {
        return this.prisma.local_fields.findMany({
            where: unionId ? { union_id: unionId } : undefined,
            orderBy: { name: 'asc' },
        });
    }
    async createLocalField(dto, actorId) {
        await this.ensureUnionExists(dto.union_id);
        const name = this.normalizeName(dto.name);
        const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
        await this.ensureLocalFieldUnique(name, abbreviation);
        const localField = await this.prisma.local_fields.create({
            data: {
                name,
                abbreviation,
                union_id: dto.union_id,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'local_fields', localField.local_field_id, actorId);
        return localField;
    }
    async updateLocalField(localFieldId, dto, actorId) {
        await this.ensureLocalFieldExists(localFieldId);
        if (dto.union_id) {
            await this.ensureUnionExists(dto.union_id);
        }
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        const abbreviation = dto.abbreviation
            ? this.normalizeAbbreviation(dto.abbreviation)
            : undefined;
        if (name || abbreviation) {
            await this.ensureLocalFieldUnique(name, abbreviation, localFieldId);
        }
        const localField = await this.prisma.local_fields.update({
            where: { local_field_id: localFieldId },
            data: {
                ...(name ? { name } : {}),
                ...(abbreviation ? { abbreviation } : {}),
                ...(dto.union_id ? { union_id: dto.union_id } : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'local_fields', localFieldId, actorId);
        return localField;
    }
    async deleteLocalField(localFieldId, actorId) {
        await this.ensureLocalFieldExists(localFieldId);
        const activeDistricts = await this.prisma.districts.count({
            where: {
                local_field_id: localFieldId,
                active: true,
            },
        });
        if (activeDistricts > 0) {
            throw new common_1.ConflictException('Cannot deactivate local field with active districts');
        }
        const localField = await this.prisma.local_fields.update({
            where: { local_field_id: localFieldId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'local_fields', localFieldId, actorId);
        return localField;
    }
    async listDistricts(localFieldId) {
        return this.prisma.districts.findMany({
            where: localFieldId ? { local_field_id: localFieldId } : undefined,
            orderBy: { name: 'asc' },
        });
    }
    async createDistrict(dto, actorId) {
        await this.ensureLocalFieldExists(dto.local_field_id);
        const name = this.normalizeName(dto.name);
        const existing = await this.prisma.districts.findFirst({
            where: {
                local_field_id: dto.local_field_id,
                name: { equals: name, mode: 'insensitive' },
                active: true,
            },
        });
        if (existing) {
            throw new common_1.ConflictException('District with this name already exists');
        }
        const district = await this.prisma.districts.create({
            data: {
                name,
                local_field_id: dto.local_field_id,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'districts', district.districlub_type_id, actorId);
        return district;
    }
    async updateDistrict(districtId, dto, actorId) {
        const current = await this.ensureDistrictExists(districtId);
        if (dto.local_field_id) {
            await this.ensureLocalFieldExists(dto.local_field_id);
        }
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        const nextLocalFieldId = dto.local_field_id ?? current.local_field_id;
        if (name) {
            const existing = await this.prisma.districts.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    local_field_id: nextLocalFieldId,
                    NOT: { districlub_type_id: districtId },
                    active: true,
                },
            });
            if (existing) {
                throw new common_1.ConflictException('District with this name already exists');
            }
        }
        const district = await this.prisma.districts.update({
            where: { districlub_type_id: districtId },
            data: {
                ...(name ? { name } : {}),
                ...(dto.local_field_id ? { local_field_id: dto.local_field_id } : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'districts', districtId, actorId);
        return district;
    }
    async deleteDistrict(districtId, actorId) {
        await this.ensureDistrictExists(districtId);
        const activeChurches = await this.prisma.churches.count({
            where: {
                districlub_type_id: districtId,
                active: true,
            },
        });
        if (activeChurches > 0) {
            throw new common_1.ConflictException('Cannot deactivate district with active churches');
        }
        const district = await this.prisma.districts.update({
            where: { districlub_type_id: districtId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'districts', districtId, actorId);
        return district;
    }
    async listChurches(districtId) {
        return this.prisma.churches.findMany({
            where: districtId ? { districlub_type_id: districtId } : undefined,
            orderBy: { name: 'asc' },
        });
    }
    async createChurch(dto, actorId) {
        await this.ensureDistrictExists(dto.district_id);
        const name = this.normalizeName(dto.name);
        const existing = await this.prisma.churches.findFirst({
            where: {
                districlub_type_id: dto.district_id,
                name: { equals: name, mode: 'insensitive' },
                active: true,
            },
        });
        if (existing) {
            throw new common_1.ConflictException('Church with this name already exists');
        }
        const church = await this.prisma.churches.create({
            data: {
                name,
                districlub_type_id: dto.district_id,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'churches', church.church_id, actorId);
        return church;
    }
    async updateChurch(churchId, dto, actorId) {
        const current = await this.ensureChurchExists(churchId);
        if (dto.district_id) {
            await this.ensureDistrictExists(dto.district_id);
        }
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        const nextDistrictId = dto.district_id ?? current.districlub_type_id;
        if (name) {
            const existing = await this.prisma.churches.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    districlub_type_id: nextDistrictId,
                    NOT: { church_id: churchId },
                    active: true,
                },
            });
            if (existing) {
                throw new common_1.ConflictException('Church with this name already exists');
            }
        }
        const church = await this.prisma.churches.update({
            where: { church_id: churchId },
            data: {
                ...(name ? { name } : {}),
                ...(dto.district_id
                    ? { districlub_type_id: dto.district_id }
                    : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'churches', churchId, actorId);
        return church;
    }
    async deleteChurch(churchId, actorId) {
        await this.ensureChurchExists(churchId);
        const church = await this.prisma.churches.update({
            where: { church_id: churchId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'churches', churchId, actorId);
        return church;
    }
    async ensureCountryUnique(name, abbreviation, countryId) {
        if (name) {
            const existingByName = await this.prisma.countries.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    ...(countryId ? { NOT: { country_id: countryId } } : {}),
                },
            });
            if (existingByName) {
                throw new common_1.ConflictException('Country name already exists');
            }
        }
        if (abbreviation) {
            const existingByAbbreviation = await this.prisma.countries.findFirst({
                where: {
                    abbreviation: { equals: abbreviation, mode: 'insensitive' },
                    ...(countryId ? { NOT: { country_id: countryId } } : {}),
                },
            });
            if (existingByAbbreviation) {
                throw new common_1.ConflictException('Country abbreviation already exists');
            }
        }
    }
    async ensureUnionUnique(name, abbreviation, unionId) {
        if (name) {
            const existingByName = await this.prisma.unions.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    ...(unionId ? { NOT: { union_id: unionId } } : {}),
                },
            });
            if (existingByName) {
                throw new common_1.ConflictException('Union name already exists');
            }
        }
        if (abbreviation) {
            const existingByAbbreviation = await this.prisma.unions.findFirst({
                where: {
                    abbreviation: { equals: abbreviation, mode: 'insensitive' },
                    ...(unionId ? { NOT: { union_id: unionId } } : {}),
                },
            });
            if (existingByAbbreviation) {
                throw new common_1.ConflictException('Union abbreviation already exists');
            }
        }
    }
    async ensureLocalFieldUnique(name, abbreviation, localFieldId) {
        if (name) {
            const existingByName = await this.prisma.local_fields.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    ...(localFieldId ? { NOT: { local_field_id: localFieldId } } : {}),
                },
            });
            if (existingByName) {
                throw new common_1.ConflictException('Local field name already exists');
            }
        }
        if (abbreviation) {
            const existingByAbbreviation = await this.prisma.local_fields.findFirst({
                where: {
                    abbreviation: { equals: abbreviation, mode: 'insensitive' },
                    ...(localFieldId ? { NOT: { local_field_id: localFieldId } } : {}),
                },
            });
            if (existingByAbbreviation) {
                throw new common_1.ConflictException('Local field abbreviation already exists');
            }
        }
    }
    async ensureCountryExists(countryId) {
        const country = await this.prisma.countries.findUnique({
            where: { country_id: countryId },
        });
        if (!country) {
            throw new common_1.NotFoundException(`Country ${countryId} not found`);
        }
        return country;
    }
    async ensureUnionExists(unionId) {
        const union = await this.prisma.unions.findUnique({
            where: { union_id: unionId },
        });
        if (!union) {
            throw new common_1.NotFoundException(`Union ${unionId} not found`);
        }
        return union;
    }
    async ensureLocalFieldExists(localFieldId) {
        const localField = await this.prisma.local_fields.findUnique({
            where: { local_field_id: localFieldId },
        });
        if (!localField) {
            throw new common_1.NotFoundException(`Local field ${localFieldId} not found`);
        }
        return localField;
    }
    async ensureDistrictExists(districtId) {
        const district = await this.prisma.districts.findUnique({
            where: { districlub_type_id: districtId },
        });
        if (!district) {
            throw new common_1.NotFoundException(`District ${districtId} not found`);
        }
        return district;
    }
    async ensureChurchExists(churchId) {
        const church = await this.prisma.churches.findUnique({
            where: { church_id: churchId },
        });
        if (!church) {
            throw new common_1.NotFoundException(`Church ${churchId} not found`);
        }
        return church;
    }
};
exports.AdminGeographyService = AdminGeographyService;
exports.AdminGeographyService = AdminGeographyService = AdminGeographyService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminGeographyService);
//# sourceMappingURL=admin-geography.service.js.map