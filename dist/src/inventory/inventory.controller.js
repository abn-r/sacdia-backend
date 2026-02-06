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
exports.InventoryController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const inventory_service_1 = require("./inventory.service");
const create_item_dto_1 = require("./dto/create-item.dto");
const update_item_dto_1 = require("./dto/update-item.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let InventoryController = class InventoryController {
    inventoryService;
    constructor(inventoryService) {
        this.inventoryService = inventoryService;
    }
    async findAllByClub(clubId, instanceType, categoryId) {
        const result = await this.inventoryService.findAllByClub(clubId, instanceType, categoryId);
        return {
            status: 'success',
            ...result,
        };
    }
    async findOne(id) {
        const data = await this.inventoryService.findOne(id);
        return {
            status: 'success',
            data,
        };
    }
    async create(clubId, dto) {
        const data = await this.inventoryService.create(clubId, dto);
        return {
            status: 'success',
            data,
        };
    }
    async update(id, dto) {
        const data = await this.inventoryService.update(id, dto);
        return {
            status: 'success',
            data,
        };
    }
    async delete(id) {
        const data = await this.inventoryService.delete(id);
        return {
            status: 'success',
            ...data,
        };
    }
    async findAllCategories() {
        const data = await this.inventoryService.findAllCategories();
        return {
            status: 'success',
            data,
        };
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)('clubs/:clubId/inventory'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar items del inventario de un club',
        description: 'Obtiene todos los items de inventario de una instancia específica de club (Aventureros, Conquistadores, o Guías Mayores)',
    }),
    (0, swagger_1.ApiParam)({
        name: 'clubId',
        description: 'ID de la instancia del club',
        example: 5,
    }),
    (0, swagger_1.ApiQuery)({
        name: 'instanceType',
        description: 'Tipo de instancia del club (adv: Aventureros, pathf: Conquistadores, mg: Guías Mayores)',
        example: 'pathf',
        required: true,
    }),
    (0, swagger_1.ApiQuery)({
        name: 'category',
        description: 'Filtrar por ID de categoría',
        example: 1,
        required: false,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de items del inventario con metadata',
    }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Tipo de instancia inválido' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'No autenticado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('clubId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('instanceType')),
    __param(2, (0, common_1.Query)('category', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, Number]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "findAllByClub", null);
__decorate([
    (0, common_1.Get)('inventory/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener detalles de un item del inventario',
        description: 'Obtiene información detallada de un item específico incluyendo historial de cambios',
    }),
    (0, swagger_1.ApiParam)({
        name: 'id',
        description: 'ID del item de inventario',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Detalles del item con historial',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Item no encontrado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)('clubs/:clubId/inventory'),
    (0, swagger_1.ApiOperation)({
        summary: 'Agregar nuevo item al inventario',
        description: 'Crea un nuevo item de inventario para una instancia específica de club. Requiere rol de Director, Subdirector o Tesorero.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'clubId',
        description: 'ID de la instancia del club',
        example: 5,
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Item creado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Club o categoría no encontrados' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'No tiene permisos para agregar items',
    }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('clubId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, create_item_dto_1.CreateItemDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('inventory/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Actualizar un item del inventario',
        description: 'Actualiza información de un item existente. Requiere rol de Director, Subdirector o Tesorero.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'id',
        description: 'ID del item de inventario',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Item actualizado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Item no encontrado' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'No tiene permisos para actualizar items',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_item_dto_1.UpdateItemDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)('inventory/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Eliminar un item del inventario',
        description: 'Elimina un item del inventario (soft delete). Requiere rol de Director o Subdirector.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'id',
        description: 'ID del item de inventario',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Item eliminado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Item no encontrado' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'No tiene permisos para eliminar items',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "delete", null);
__decorate([
    (0, common_1.Get)('catalogs/inventory-categories'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar categorías de inventario',
        description: 'Obtiene todas las categorías disponibles para clasificar items de inventario',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de categorías de inventario',
    }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "findAllCategories", null);
exports.InventoryController = InventoryController = __decorate([
    (0, swagger_1.ApiTags)('inventory'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('inventory'),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map