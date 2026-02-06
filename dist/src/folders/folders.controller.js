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
exports.FoldersController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const folders_service_1 = require("./folders.service");
const update_section_record_dto_1 = require("./dto/update-section-record.dto");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let FoldersController = class FoldersController {
    foldersService;
    constructor(foldersService) {
        this.foldersService = foldersService;
    }
    async findAll(clubTypeId, paginationDto) {
        const result = await this.foldersService.findAll(clubTypeId, paginationDto);
        return {
            status: 'success',
            data: result.data,
            meta: result.meta,
        };
    }
    async findOne(id) {
        const data = await this.foldersService.findOne(id);
        return {
            status: 'success',
            data,
        };
    }
    async enrollUser(userId, folderId) {
        const data = await this.foldersService.enrollUser(userId, folderId);
        return {
            status: 'success',
            data,
        };
    }
    async getUserFolders(userId) {
        const data = await this.foldersService.getUserFolders(userId);
        return {
            status: 'success',
            data,
        };
    }
    async getFolderProgress(userId, folderId) {
        const data = await this.foldersService.getFolderProgress(userId, folderId);
        return {
            status: 'success',
            data,
        };
    }
    async updateSectionProgress(userId, folderId, moduleId, sectionId, dto) {
        const data = await this.foldersService.updateSectionProgress(userId, folderId, moduleId, sectionId, dto);
        return {
            status: 'success',
            data,
        };
    }
    async deleteAssignment(userId, folderId) {
        const data = await this.foldersService.deleteAssignment(userId, folderId);
        return {
            status: 'success',
            ...data,
        };
    }
};
exports.FoldersController = FoldersController;
__decorate([
    (0, common_1.Get)('folders'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar templates de carpetas disponibles',
        description: 'Obtiene lista paginada de templates de carpetas activos con count de módulos',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'club_type',
        required: false,
        description: 'Filtrar por tipo de club (1: Aventureros, 2: Conquistadores, 3: Guías Mayores)',
        example: 2,
    }),
    (0, swagger_1.ApiQuery)({
        name: 'page',
        required: false,
        description: 'Número de página (default: 1)',
        example: 1,
    }),
    (0, swagger_1.ApiQuery)({
        name: 'limit',
        required: false,
        description: 'Resultados por página (default: 50, max: 100)',
        example: 50,
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista de templates de carpetas' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'No autenticado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('club_type', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, pagination_dto_1.PaginationDto]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('folders/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener detalles de un template de carpeta',
        description: 'Obtiene información completa de un template de carpeta incluyendo módulos y secciones con puntos',
    }),
    (0, swagger_1.ApiParam)({
        name: 'id',
        description: 'ID del template de carpeta',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Detalles del template con módulos y secciones',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Template de carpeta no encontrado',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)('users/:userId/folders/:folderId/enroll'),
    (0, swagger_1.ApiOperation)({
        summary: 'Inscribirse en una carpeta',
        description: 'Asigna un template de carpeta a un usuario. Valida que el usuario pertenezca a un club del tipo requerido.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'folderId',
        description: 'ID del template de carpeta',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Carpeta asignada exitosamente' }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Usuario no pertenece a un club del tipo requerido',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Template de carpeta no encontrado',
    }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Usuario ya tiene una asignación activa para esta carpeta',
    }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('folderId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "enrollUser", null);
__decorate([
    (0, common_1.Get)('users/:userId/folders'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar carpetas asignadas del usuario',
        description: 'Obtiene todas las carpetas asignadas al usuario con progreso y estado',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de carpetas del usuario con progreso',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "getUserFolders", null);
__decorate([
    (0, common_1.Get)('users/:userId/folders/:folderId/progress'),
    (0, swagger_1.ApiOperation)({
        summary: 'Ver progreso detallado de una carpeta',
        description: 'Obtiene el progreso detallado por módulos y secciones con evidencias',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'folderId',
        description: 'ID del template de carpeta',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Progreso detallado de la carpeta',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Asignación de carpeta no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('folderId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "getFolderProgress", null);
__decorate([
    (0, common_1.Patch)('users/:userId/folders/:folderId/modules/:moduleId/sections/:sectionId'),
    (0, swagger_1.ApiOperation)({
        summary: 'Actualizar progreso de una sección',
        description: 'Registra evidencias y puntos obtenidos en una sección. Auto-completa módulo y carpeta según criterios.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'folderId',
        description: 'ID del template de carpeta',
        example: 1,
    }),
    (0, swagger_1.ApiParam)({
        name: 'moduleId',
        description: 'ID del módulo',
        example: 1,
    }),
    (0, swagger_1.ApiParam)({
        name: 'sectionId',
        description: 'ID de la sección',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Progreso actualizado exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Puntos exceden el máximo o módulo/sección inválidos',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Asignación de carpeta no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('folderId', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('moduleId', common_1.ParseIntPipe)),
    __param(3, (0, common_1.Param)('sectionId', common_1.ParseIntPipe)),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, Number, Number, update_section_record_dto_1.UpdateSectionRecordDto]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "updateSectionProgress", null);
__decorate([
    (0, common_1.Delete)('users/:userId/folders/:folderId'),
    (0, swagger_1.ApiOperation)({
        summary: 'Abandonar una carpeta',
        description: 'Desactiva la asignación de carpeta del usuario (soft delete)',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'folderId',
        description: 'ID del template de carpeta',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Asignación eliminada exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Asignación de carpeta no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('folderId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "deleteAssignment", null);
exports.FoldersController = FoldersController = __decorate([
    (0, swagger_1.ApiTags)('folders'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('folders'),
    __metadata("design:paramtypes", [folders_service_1.FoldersService])
], FoldersController);
//# sourceMappingURL=folders.controller.js.map