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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminReferenceController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const global_roles_decorator_1 = require("../common/decorators/global-roles.decorator");
const guards_1 = require("../common/guards");
const admin_reference_service_1 = require("./admin-reference.service");
const dto_1 = require("./dto");
let AdminReferenceController = class AdminReferenceController {
    referenceService;
    constructor(referenceService) {
        this.referenceService = referenceService;
    }
    async listRelationshipTypes() {
        const data = await this.referenceService.listRelationshipTypes();
        return { status: 'success', data };
    }
    async createRelationshipType(dto, req) {
        const data = await this.referenceService.createRelationshipType(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateRelationshipType(relationshipTypeId, dto, req) {
        const data = await this.referenceService.updateRelationshipType(relationshipTypeId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteRelationshipType(relationshipTypeId, req) {
        const data = await this.referenceService.deleteRelationshipType(relationshipTypeId, req.user.sub);
        return { status: 'success', data };
    }
    async listAllergies() {
        const data = await this.referenceService.listAllergies();
        return { status: 'success', data };
    }
    async createAllergy(dto, req) {
        const data = await this.referenceService.createAllergy(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateAllergy(allergyId, dto, req) {
        const data = await this.referenceService.updateAllergy(allergyId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteAllergy(allergyId, req) {
        const data = await this.referenceService.deleteAllergy(allergyId, req.user.sub);
        return { status: 'success', data };
    }
    async listDiseases() {
        const data = await this.referenceService.listDiseases();
        return { status: 'success', data };
    }
    async createDisease(dto, req) {
        const data = await this.referenceService.createDisease(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateDisease(diseaseId, dto, req) {
        const data = await this.referenceService.updateDisease(diseaseId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteDisease(diseaseId, req) {
        const data = await this.referenceService.deleteDisease(diseaseId, req.user.sub);
        return { status: 'success', data };
    }
    async listEcclesiasticalYears() {
        const data = await this.referenceService.listEcclesiasticalYears();
        return { status: 'success', data };
    }
    async createEcclesiasticalYear(dto, req) {
        const data = await this.referenceService.createEcclesiasticalYear(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateEcclesiasticalYear(yearId, dto, req) {
        const data = await this.referenceService.updateEcclesiasticalYear(yearId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteEcclesiasticalYear(yearId, req) {
        const data = await this.referenceService.deleteEcclesiasticalYear(yearId, req.user.sub);
        return { status: 'success', data };
    }
};
exports.AdminReferenceController = AdminReferenceController;
__decorate([
    (0, common_1.Get)('relationship-types'),
    (0, swagger_1.ApiOperation)({ summary: 'List relationship types for admin management' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "listRelationshipTypes", null);
__decorate([
    (0, common_1.Post)('relationship-types'),
    (0, swagger_1.ApiOperation)({ summary: 'Create relationship type' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateRelationshipTypeDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "createRelationshipType", null);
__decorate([
    (0, common_1.Patch)('relationship-types/:relationshipTypeId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update relationship type' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('relationshipTypeId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateRelationshipTypeDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "updateRelationshipType", null);
__decorate([
    (0, common_1.Delete)('relationship-types/:relationshipTypeId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete relationship type' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('relationshipTypeId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "deleteRelationshipType", null);
__decorate([
    (0, common_1.Get)('allergies'),
    (0, swagger_1.ApiOperation)({ summary: 'List allergies for admin management' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "listAllergies", null);
__decorate([
    (0, common_1.Post)('allergies'),
    (0, swagger_1.ApiOperation)({ summary: 'Create allergy' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateAllergyDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "createAllergy", null);
__decorate([
    (0, common_1.Patch)('allergies/:allergyId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update allergy' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('allergyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateAllergyDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "updateAllergy", null);
__decorate([
    (0, common_1.Delete)('allergies/:allergyId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete allergy' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('allergyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "deleteAllergy", null);
__decorate([
    (0, common_1.Get)('diseases'),
    (0, swagger_1.ApiOperation)({ summary: 'List diseases for admin management' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "listDiseases", null);
__decorate([
    (0, common_1.Post)('diseases'),
    (0, swagger_1.ApiOperation)({ summary: 'Create disease' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateDiseaseDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "createDisease", null);
__decorate([
    (0, common_1.Patch)('diseases/:diseaseId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update disease' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('diseaseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateDiseaseDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "updateDisease", null);
__decorate([
    (0, common_1.Delete)('diseases/:diseaseId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete disease' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('diseaseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "deleteDisease", null);
__decorate([
    (0, common_1.Get)('ecclesiastical-years'),
    (0, swagger_1.ApiOperation)({ summary: 'List ecclesiastical years for admin management' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "listEcclesiasticalYears", null);
__decorate([
    (0, common_1.Post)('ecclesiastical-years'),
    (0, swagger_1.ApiOperation)({ summary: 'Create ecclesiastical year' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateEcclesiasticalYearDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "createEcclesiasticalYear", null);
__decorate([
    (0, common_1.Patch)('ecclesiastical-years/:yearId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update ecclesiastical year' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('yearId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateEcclesiasticalYearDto, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "updateEcclesiasticalYear", null);
__decorate([
    (0, common_1.Delete)('ecclesiastical-years/:yearId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete ecclesiastical year' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('yearId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminReferenceController.prototype, "deleteEcclesiasticalYear", null);
exports.AdminReferenceController = AdminReferenceController = __decorate([
    (0, swagger_1.ApiTags)('admin-reference'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.GlobalRolesGuard),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [admin_reference_service_1.AdminReferenceService])
], AdminReferenceController);
//# sourceMappingURL=admin-reference.controller.js.map