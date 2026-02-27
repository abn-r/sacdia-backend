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
exports.CamporeesController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const camporees_service_1 = require("./camporees.service");
const guards_1 = require("../common/guards");
const decorators_1 = require("../common/decorators");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const dto_1 = require("./dto");
let CamporeesController = class CamporeesController {
    camporeesService;
    constructor(camporeesService) {
        this.camporeesService = camporeesService;
    }
    async findAll(active, page, limit) {
        const pagination = new pagination_dto_1.PaginationDto();
        if (page)
            pagination.page = page;
        if (limit)
            pagination.limit = Math.min(limit, 100);
        return this.camporeesService.findAll({
            active: active === 'true' ? true : active === 'false' ? false : undefined,
        }, pagination);
    }
    async findOne(camporeeId) {
        return this.camporeesService.findOne(camporeeId);
    }
    async create(dto, req) {
        return this.camporeesService.create(dto, req.user.sub);
    }
    async update(camporeeId, dto) {
        return this.camporeesService.update(camporeeId, dto);
    }
    async remove(camporeeId) {
        return this.camporeesService.remove(camporeeId);
    }
    async registerMember(camporeeId, dto) {
        return this.camporeesService.registerMember(camporeeId, dto);
    }
    async getMembers(camporeeId) {
        return this.camporeesService.getMembers(camporeeId);
    }
    async removeMember(camporeeId, userId) {
        return this.camporeesService.removeMember(camporeeId, userId);
    }
};
exports.CamporeesController = CamporeesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar camporees',
        description: 'Obtiene todos los camporees disponibles',
    }),
    (0, swagger_1.ApiQuery)({ name: 'active', required: false, type: Boolean }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista paginada de camporees' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('active')),
    __param(1, (0, common_1.Query)('page', new common_1.ParseIntPipe({ optional: true }))),
    __param(2, (0, common_1.Query)('limit', new common_1.ParseIntPipe({ optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, Number]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':camporeeId'),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener camporee por ID' }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Camporee encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Camporee no encontrado' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(guards_1.ClubRolesGuard),
    (0, decorators_1.ClubRoles)('director', 'deputy_director'),
    (0, swagger_1.ApiOperation)({
        summary: 'Crear camporee',
        description: 'Crea un nuevo camporee (requiere rol de liderazgo)',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Camporee creado' }),
    (0, swagger_1.ApiResponse)({ status: 403, description: 'Permisos insuficientes' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateCamporeeDto, Object]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':camporeeId'),
    (0, common_1.UseGuards)(guards_1.ClubRolesGuard),
    (0, decorators_1.ClubRoles)('director', 'deputy_director'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar camporee' }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Camporee actualizado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Camporee no encontrado' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateCamporeeDto]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':camporeeId'),
    (0, common_1.UseGuards)(guards_1.ClubRolesGuard),
    (0, decorators_1.ClubRoles)('director'),
    (0, swagger_1.ApiOperation)({ summary: 'Desactivar camporee' }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Camporee desactivado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Camporee no encontrado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':camporeeId/register'),
    (0, swagger_1.ApiOperation)({
        summary: 'Registrar miembro en camporee',
        description: 'Registra un miembro en el camporee con validación de seguro',
    }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Miembro registrado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Error de validación' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Camporee no encontrado' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.RegisterMemberDto]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "registerMember", null);
__decorate([
    (0, common_1.Get)(':camporeeId/members'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar miembros del camporee',
        description: 'Obtiene la lista de miembros registrados en el camporee',
    }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista de miembros' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Camporee no encontrado' }),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "getMembers", null);
__decorate([
    (0, common_1.Delete)(':camporeeId/members/:userId'),
    (0, common_1.UseGuards)(guards_1.ClubRolesGuard),
    (0, decorators_1.ClubRoles)('director', 'deputy_director'),
    (0, swagger_1.ApiOperation)({
        summary: 'Remover miembro del camporee',
        description: 'Desactiva el registro de un miembro en el camporee',
    }),
    (0, swagger_1.ApiParam)({ name: 'camporeeId', type: Number }),
    (0, swagger_1.ApiParam)({ name: 'userId', type: String }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Miembro removido' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Registro no encontrado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('camporeeId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", Promise)
], CamporeesController.prototype, "removeMember", null);
exports.CamporeesController = CamporeesController = __decorate([
    (0, swagger_1.ApiTags)('camporees'),
    (0, common_1.Controller)('camporees'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [camporees_service_1.CamporeesService])
], CamporeesController);
//# sourceMappingURL=camporees.controller.js.map