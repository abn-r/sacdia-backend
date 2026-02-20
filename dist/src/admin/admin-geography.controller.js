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
exports.AdminGeographyController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const global_roles_decorator_1 = require("../common/decorators/global-roles.decorator");
const guards_1 = require("../common/guards");
const admin_geography_service_1 = require("./admin-geography.service");
const dto_1 = require("./dto");
let AdminGeographyController = class AdminGeographyController {
    geographyService;
    constructor(geographyService) {
        this.geographyService = geographyService;
    }
    async listCountries() {
        const data = await this.geographyService.listCountries();
        return { status: 'success', data };
    }
    async createCountry(dto, req) {
        const data = await this.geographyService.createCountry(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateCountry(countryId, dto, req) {
        const data = await this.geographyService.updateCountry(countryId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteCountry(countryId, req) {
        const data = await this.geographyService.deleteCountry(countryId, req.user.sub);
        return { status: 'success', data };
    }
    async listUnions(countryId) {
        const data = await this.geographyService.listUnions(countryId);
        return { status: 'success', data };
    }
    async createUnion(dto, req) {
        const data = await this.geographyService.createUnion(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateUnion(unionId, dto, req) {
        const data = await this.geographyService.updateUnion(unionId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteUnion(unionId, req) {
        const data = await this.geographyService.deleteUnion(unionId, req.user.sub);
        return { status: 'success', data };
    }
    async listLocalFields(unionId) {
        const data = await this.geographyService.listLocalFields(unionId);
        return { status: 'success', data };
    }
    async createLocalField(dto, req) {
        const data = await this.geographyService.createLocalField(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateLocalField(localFieldId, dto, req) {
        const data = await this.geographyService.updateLocalField(localFieldId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteLocalField(localFieldId, req) {
        const data = await this.geographyService.deleteLocalField(localFieldId, req.user.sub);
        return { status: 'success', data };
    }
    async listDistricts(localFieldId) {
        const data = await this.geographyService.listDistricts(localFieldId);
        return { status: 'success', data };
    }
    async createDistrict(dto, req) {
        const data = await this.geographyService.createDistrict(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateDistrict(districtId, dto, req) {
        const data = await this.geographyService.updateDistrict(districtId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteDistrict(districtId, req) {
        const data = await this.geographyService.deleteDistrict(districtId, req.user.sub);
        return { status: 'success', data };
    }
    async listChurches(districtId) {
        const data = await this.geographyService.listChurches(districtId);
        return { status: 'success', data };
    }
    async createChurch(dto, req) {
        const data = await this.geographyService.createChurch(dto, req.user.sub);
        return { status: 'success', data };
    }
    async updateChurch(churchId, dto, req) {
        const data = await this.geographyService.updateChurch(churchId, dto, req.user.sub);
        return { status: 'success', data };
    }
    async deleteChurch(churchId, req) {
        const data = await this.geographyService.deleteChurch(churchId, req.user.sub);
        return { status: 'success', data };
    }
};
exports.AdminGeographyController = AdminGeographyController;
__decorate([
    (0, common_1.Get)('countries'),
    (0, swagger_1.ApiOperation)({ summary: 'List countries for admin management' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "listCountries", null);
__decorate([
    (0, common_1.Post)('countries'),
    (0, swagger_1.ApiOperation)({ summary: 'Create country' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateCountryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "createCountry", null);
__decorate([
    (0, common_1.Patch)('countries/:countryId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update country' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('countryId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateCountryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "updateCountry", null);
__decorate([
    (0, common_1.Delete)('countries/:countryId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete country' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('countryId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "deleteCountry", null);
__decorate([
    (0, common_1.Get)('unions'),
    (0, swagger_1.ApiOperation)({ summary: 'List unions for admin management' }),
    (0, swagger_1.ApiQuery)({ name: 'countryId', required: false, type: Number }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('countryId', new common_1.ParseIntPipe({ optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "listUnions", null);
__decorate([
    (0, common_1.Post)('unions'),
    (0, swagger_1.ApiOperation)({ summary: 'Create union' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateUnionDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "createUnion", null);
__decorate([
    (0, common_1.Patch)('unions/:unionId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update union' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('unionId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateUnionDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "updateUnion", null);
__decorate([
    (0, common_1.Delete)('unions/:unionId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete union' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('unionId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "deleteUnion", null);
__decorate([
    (0, common_1.Get)('local-fields'),
    (0, swagger_1.ApiOperation)({ summary: 'List local fields for admin management' }),
    (0, swagger_1.ApiQuery)({ name: 'unionId', required: false, type: Number }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('unionId', new common_1.ParseIntPipe({ optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "listLocalFields", null);
__decorate([
    (0, common_1.Post)('local-fields'),
    (0, swagger_1.ApiOperation)({ summary: 'Create local field' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateLocalFieldDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "createLocalField", null);
__decorate([
    (0, common_1.Patch)('local-fields/:localFieldId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update local field' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('localFieldId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateLocalFieldDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "updateLocalField", null);
__decorate([
    (0, common_1.Delete)('local-fields/:localFieldId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete local field' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('localFieldId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "deleteLocalField", null);
__decorate([
    (0, common_1.Get)('districts'),
    (0, swagger_1.ApiOperation)({ summary: 'List districts for admin management' }),
    (0, swagger_1.ApiQuery)({ name: 'localFieldId', required: false, type: Number }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('localFieldId', new common_1.ParseIntPipe({ optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "listDistricts", null);
__decorate([
    (0, common_1.Post)('districts'),
    (0, swagger_1.ApiOperation)({ summary: 'Create district' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateDistrictDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "createDistrict", null);
__decorate([
    (0, common_1.Patch)('districts/:districtId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update district' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('districtId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateDistrictDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "updateDistrict", null);
__decorate([
    (0, common_1.Delete)('districts/:districtId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete district' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('districtId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "deleteDistrict", null);
__decorate([
    (0, common_1.Get)('churches'),
    (0, swagger_1.ApiOperation)({ summary: 'List churches for admin management' }),
    (0, swagger_1.ApiQuery)({ name: 'districtId', required: false, type: Number }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('districtId', new common_1.ParseIntPipe({ optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "listChurches", null);
__decorate([
    (0, common_1.Post)('churches'),
    (0, swagger_1.ApiOperation)({ summary: 'Create church' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateChurchDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "createChurch", null);
__decorate([
    (0, common_1.Patch)('churches/:churchId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update church' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('churchId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateChurchDto, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "updateChurch", null);
__decorate([
    (0, common_1.Delete)('churches/:churchId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete church' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('churchId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AdminGeographyController.prototype, "deleteChurch", null);
exports.AdminGeographyController = AdminGeographyController = __decorate([
    (0, swagger_1.ApiTags)('admin-geography'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.GlobalRolesGuard),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [admin_geography_service_1.AdminGeographyService])
], AdminGeographyController);
//# sourceMappingURL=admin-geography.controller.js.map