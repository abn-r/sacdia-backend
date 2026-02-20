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
var AdminReferenceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminReferenceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AdminReferenceService = AdminReferenceService_1 = class AdminReferenceService {
    prisma;
    logger = new common_1.Logger(AdminReferenceService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    normalizeName(value) {
        return value.trim().replace(/\s+/g, ' ');
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
    async listRelationshipTypes() {
        return this.prisma.relationship_types.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async createRelationshipType(dto, actorId) {
        const name = this.normalizeName(dto.name);
        await this.ensureRelationshipTypeUnique(name);
        const relationshipType = await this.prisma.relationship_types.create({
            data: {
                name,
                description: dto.description,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'relationship_types', relationshipType.relationship_type_id, actorId);
        return relationshipType;
    }
    async updateRelationshipType(relationshipTypeId, dto, actorId) {
        await this.ensureRelationshipTypeExists(relationshipTypeId);
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        if (name) {
            await this.ensureRelationshipTypeUnique(name, relationshipTypeId);
        }
        const relationshipType = await this.prisma.relationship_types.update({
            where: { relationship_type_id: relationshipTypeId },
            data: {
                ...(name ? { name } : {}),
                ...(typeof dto.description === 'string'
                    ? { description: dto.description }
                    : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'relationship_types', relationshipTypeId, actorId);
        return relationshipType;
    }
    async deleteRelationshipType(relationshipTypeId, actorId) {
        await this.ensureRelationshipTypeExists(relationshipTypeId);
        const inUseCount = await this.prisma.legal_representatives.count({
            where: { relationship_type_id: relationshipTypeId },
        });
        if (inUseCount > 0) {
            throw new common_1.ConflictException('Cannot deactivate relationship type because it is in use');
        }
        const relationshipType = await this.prisma.relationship_types.update({
            where: { relationship_type_id: relationshipTypeId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'relationship_types', relationshipTypeId, actorId);
        return relationshipType;
    }
    async listAllergies() {
        return this.prisma.allergies.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async createAllergy(dto, actorId) {
        const name = this.normalizeName(dto.name);
        await this.ensureAllergyUnique(name);
        const allergy = await this.prisma.allergies.create({
            data: {
                name,
                description: dto.description,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'allergies', allergy.allergy_id, actorId);
        return allergy;
    }
    async updateAllergy(allergyId, dto, actorId) {
        await this.ensureAllergyExists(allergyId);
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        if (name) {
            await this.ensureAllergyUnique(name, allergyId);
        }
        const allergy = await this.prisma.allergies.update({
            where: { allergy_id: allergyId },
            data: {
                ...(name ? { name } : {}),
                ...(typeof dto.description === 'string'
                    ? { description: dto.description }
                    : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'allergies', allergyId, actorId);
        return allergy;
    }
    async deleteAllergy(allergyId, actorId) {
        await this.ensureAllergyExists(allergyId);
        const inUseCount = await this.prisma.users_allergies.count({
            where: {
                allergy_id: allergyId,
                active: true,
            },
        });
        if (inUseCount > 0) {
            throw new common_1.ConflictException('Cannot deactivate allergy because it is in use');
        }
        const allergy = await this.prisma.allergies.update({
            where: { allergy_id: allergyId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'allergies', allergyId, actorId);
        return allergy;
    }
    async listDiseases() {
        return this.prisma.diseases.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async createDisease(dto, actorId) {
        const name = this.normalizeName(dto.name);
        await this.ensureDiseaseUnique(name);
        const disease = await this.prisma.diseases.create({
            data: {
                name,
                description: dto.description,
                active: dto.active ?? true,
            },
        });
        this.logMutation('create', 'diseases', disease.disease_id, actorId);
        return disease;
    }
    async updateDisease(diseaseId, dto, actorId) {
        await this.ensureDiseaseExists(diseaseId);
        const name = dto.name ? this.normalizeName(dto.name) : undefined;
        if (name) {
            await this.ensureDiseaseUnique(name, diseaseId);
        }
        const disease = await this.prisma.diseases.update({
            where: { disease_id: diseaseId },
            data: {
                ...(name ? { name } : {}),
                ...(typeof dto.description === 'string'
                    ? { description: dto.description }
                    : {}),
                ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                modified_at: new Date(),
            },
        });
        this.logMutation('update', 'diseases', diseaseId, actorId);
        return disease;
    }
    async deleteDisease(diseaseId, actorId) {
        await this.ensureDiseaseExists(diseaseId);
        const inUseCount = await this.prisma.users_diseases.count({
            where: {
                disease_id: diseaseId,
                active: true,
            },
        });
        if (inUseCount > 0) {
            throw new common_1.ConflictException('Cannot deactivate disease because it is in use');
        }
        const disease = await this.prisma.diseases.update({
            where: { disease_id: diseaseId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'diseases', diseaseId, actorId);
        return disease;
    }
    async listEcclesiasticalYears() {
        return this.prisma.ecclesiastical_years.findMany({
            orderBy: { start_date: 'desc' },
        });
    }
    async createEcclesiasticalYear(dto, actorId) {
        const startDate = new Date(dto.start_date);
        const endDate = new Date(dto.end_date);
        this.validateDateRange(startDate, endDate);
        const data = {
            start_date: startDate,
            end_date: endDate,
            active: dto.active ?? false,
        };
        const year = await this.prisma.$transaction(async (tx) => {
            if (data.active) {
                await tx.ecclesiastical_years.updateMany({
                    where: { active: true },
                    data: { active: false, modified_at: new Date() },
                });
            }
            return tx.ecclesiastical_years.create({ data });
        });
        this.logMutation('create', 'ecclesiastical_years', year.year_id, actorId);
        return year;
    }
    async updateEcclesiasticalYear(yearId, dto, actorId) {
        const current = await this.ensureEcclesiasticalYearExists(yearId);
        const startDate = dto.start_date
            ? new Date(dto.start_date)
            : current.start_date;
        const endDate = dto.end_date ? new Date(dto.end_date) : current.end_date;
        this.validateDateRange(startDate, endDate);
        const year = await this.prisma.$transaction(async (tx) => {
            if (dto.active === true) {
                await tx.ecclesiastical_years.updateMany({
                    where: { active: true, NOT: { year_id: yearId } },
                    data: { active: false, modified_at: new Date() },
                });
            }
            return tx.ecclesiastical_years.update({
                where: { year_id: yearId },
                data: {
                    ...(dto.start_date ? { start_date: startDate } : {}),
                    ...(dto.end_date ? { end_date: endDate } : {}),
                    ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
                    modified_at: new Date(),
                },
            });
        });
        this.logMutation('update', 'ecclesiastical_years', yearId, actorId);
        return year;
    }
    async deleteEcclesiasticalYear(yearId, actorId) {
        await this.ensureEcclesiasticalYearExists(yearId);
        const activeAssignments = await this.prisma.club_role_assignments.count({
            where: {
                ecclesiastical_year_id: yearId,
                active: true,
            },
        });
        if (activeAssignments > 0) {
            throw new common_1.ConflictException('Cannot deactivate ecclesiastical year with active role assignments');
        }
        const year = await this.prisma.ecclesiastical_years.update({
            where: { year_id: yearId },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
        this.logMutation('delete', 'ecclesiastical_years', yearId, actorId);
        return year;
    }
    validateDateRange(startDate, endDate) {
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            throw new common_1.BadRequestException('Invalid date format');
        }
        if (startDate >= endDate) {
            throw new common_1.BadRequestException('start_date must be before end_date');
        }
    }
    async ensureRelationshipTypeExists(relationshipTypeId) {
        const entity = await this.prisma.relationship_types.findUnique({
            where: { relationship_type_id: relationshipTypeId },
        });
        if (!entity) {
            throw new common_1.NotFoundException(`Relationship type ${relationshipTypeId} not found`);
        }
        return entity;
    }
    async ensureRelationshipTypeUnique(name, relationshipTypeId) {
        const existing = await this.prisma.relationship_types.findFirst({
            where: {
                name: { equals: name, mode: 'insensitive' },
                ...(relationshipTypeId
                    ? { NOT: { relationship_type_id: relationshipTypeId } }
                    : {}),
            },
        });
        if (existing) {
            throw new common_1.ConflictException('Relationship type name already exists');
        }
    }
    async ensureAllergyExists(allergyId) {
        const entity = await this.prisma.allergies.findUnique({
            where: { allergy_id: allergyId },
        });
        if (!entity) {
            throw new common_1.NotFoundException(`Allergy ${allergyId} not found`);
        }
        return entity;
    }
    async ensureAllergyUnique(name, allergyId) {
        const existing = await this.prisma.allergies.findFirst({
            where: {
                name: { equals: name, mode: 'insensitive' },
                ...(allergyId ? { NOT: { allergy_id: allergyId } } : {}),
            },
        });
        if (existing) {
            throw new common_1.ConflictException('Allergy name already exists');
        }
    }
    async ensureDiseaseExists(diseaseId) {
        const entity = await this.prisma.diseases.findUnique({
            where: { disease_id: diseaseId },
        });
        if (!entity) {
            throw new common_1.NotFoundException(`Disease ${diseaseId} not found`);
        }
        return entity;
    }
    async ensureDiseaseUnique(name, diseaseId) {
        const existing = await this.prisma.diseases.findFirst({
            where: {
                name: { equals: name, mode: 'insensitive' },
                ...(diseaseId ? { NOT: { disease_id: diseaseId } } : {}),
            },
        });
        if (existing) {
            throw new common_1.ConflictException('Disease name already exists');
        }
    }
    async ensureEcclesiasticalYearExists(yearId) {
        const entity = await this.prisma.ecclesiastical_years.findUnique({
            where: { year_id: yearId },
        });
        if (!entity) {
            throw new common_1.NotFoundException(`Ecclesiastical year ${yearId} not found`);
        }
        return entity;
    }
};
exports.AdminReferenceService = AdminReferenceService;
exports.AdminReferenceService = AdminReferenceService = AdminReferenceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminReferenceService);
//# sourceMappingURL=admin-reference.service.js.map