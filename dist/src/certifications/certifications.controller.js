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
exports.CertificationsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const certifications_service_1 = require("./certifications.service");
const enroll_certification_dto_1 = require("./dto/enroll-certification.dto");
const update_progress_dto_1 = require("./dto/update-progress.dto");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let CertificationsController = class CertificationsController {
    certificationsService;
    constructor(certificationsService) {
        this.certificationsService = certificationsService;
    }
    async findAll(paginationDto) {
        const result = await this.certificationsService.findAll(paginationDto);
        return {
            status: 'success',
            data: result.data,
            meta: result.meta,
        };
    }
    async findOne(id) {
        const data = await this.certificationsService.findOne(id);
        return {
            status: 'success',
            data,
        };
    }
    async enrollUser(userId, dto) {
        const data = await this.certificationsService.enrollUser(userId, dto);
        return {
            status: 'success',
            data,
        };
    }
    async getUserCertifications(userId) {
        const data = await this.certificationsService.getUserCertifications(userId);
        return {
            status: 'success',
            data,
        };
    }
    async getCertificationProgress(userId, certificationId) {
        const data = await this.certificationsService.getCertificationProgress(userId, certificationId);
        return {
            status: 'success',
            data,
        };
    }
    async updateProgress(userId, certificationId, dto) {
        const data = await this.certificationsService.updateProgress(userId, certificationId, dto);
        return {
            status: 'success',
            data,
        };
    }
    async deleteCertification(userId, certificationId) {
        const data = await this.certificationsService.deleteCertification(userId, certificationId);
        return {
            status: 'success',
            ...data,
        };
    }
};
exports.CertificationsController = CertificationsController;
__decorate([
    (0, common_1.Get)('certifications'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar todas las certificaciones disponibles',
        description: 'Obtiene lista paginada de certificaciones activas con count de módulos',
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
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista de certificaciones' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'No autenticado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [pagination_dto_1.PaginationDto]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('certifications/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener detalles de una certificación',
        description: 'Obtiene información completa de una certificación incluyendo módulos y secciones',
    }),
    (0, swagger_1.ApiParam)({
        name: 'id',
        description: 'ID de la certificación',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Detalles de la certificación con módulos y secciones',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Certificación no encontrada' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)('users/:userId/certifications/enroll'),
    (0, swagger_1.ApiOperation)({
        summary: 'Inscribirse en una certificación',
        description: 'Permite a un Guía Mayor investido inscribirse en una certificación. Valida automáticamente elegibilidad.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Inscripción creada exitosamente' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'Usuario no es Guía Mayor investido',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Certificación no encontrada' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Usuario ya inscrito en esta certificación',
    }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, enroll_certification_dto_1.EnrollCertificationDto]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "enrollUser", null);
__decorate([
    (0, common_1.Get)('users/:userId/certifications'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar certificaciones del usuario',
        description: 'Obtiene todas las certificaciones en las que está inscrito el usuario con progreso',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de certificaciones del usuario con progreso',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "getUserCertifications", null);
__decorate([
    (0, common_1.Get)('users/:userId/certifications/:certificationId/progress'),
    (0, swagger_1.ApiOperation)({
        summary: 'Ver progreso detallado de una certificación',
        description: 'Obtiene el progreso detallado por módulos y secciones de una certificación específica',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'certificationId',
        description: 'ID de la certificación',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Progreso detallado de la certificación',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Inscripción en certificación no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('certificationId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "getCertificationProgress", null);
__decorate([
    (0, common_1.Patch)('users/:userId/certifications/:certificationId/progress'),
    (0, swagger_1.ApiOperation)({
        summary: 'Actualizar progreso de una sección',
        description: 'Marca una sección como completa/incompleta. Auto-completa módulo y certificación si todas las secciones/módulos están completos.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'certificationId',
        description: 'ID de la certificación',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Progreso actualizado exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Módulo o sección inválidos para esta certificación',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Inscripción en certificación no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('certificationId', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, update_progress_dto_1.UpdateProgressDto]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "updateProgress", null);
__decorate([
    (0, common_1.Delete)('users/:userId/certifications/:certificationId'),
    (0, swagger_1.ApiOperation)({
        summary: 'Abandonar una certificación',
        description: 'Desactiva la inscripción del usuario en una certificación (soft delete)',
    }),
    (0, swagger_1.ApiParam)({
        name: 'userId',
        description: 'UUID del usuario',
        example: 'uuid-123',
    }),
    (0, swagger_1.ApiParam)({
        name: 'certificationId',
        description: 'ID de la certificación',
        example: 1,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Inscripción eliminada exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Inscripción en certificación no encontrada',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('certificationId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], CertificationsController.prototype, "deleteCertification", null);
exports.CertificationsController = CertificationsController = __decorate([
    (0, swagger_1.ApiTags)('certifications'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('certifications'),
    __metadata("design:paramtypes", [certifications_service_1.CertificationsService])
], CertificationsController);
//# sourceMappingURL=certifications.controller.js.map