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
exports.AdminListUsersQueryDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const pagination_dto_1 = require("../../common/dto/pagination.dto");
function toBoolean(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return value;
}
class AdminListUsersQueryDto extends pagination_dto_1.PaginationDto {
    search;
    role;
    active;
    unionId;
    localFieldId;
    page = 1;
    limit = 20;
    static _OPENAPI_METADATA_FACTORY() {
        return { search: { required: false, type: () => String, maxLength: 120 }, role: { required: false, type: () => String, maxLength: 50 }, active: { required: false, type: () => Boolean }, unionId: { required: false, type: () => Number, minimum: 1 }, localFieldId: { required: false, type: () => Number, minimum: 1 }, page: { required: false, type: () => Number, default: 1, minimum: 1 }, limit: { required: false, type: () => Number, default: 20, minimum: 1, maximum: 100 } };
    }
}
exports.AdminListUsersQueryDto = AdminListUsersQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Búsqueda por nombre/apellidos/email',
        example: 'juan',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], AdminListUsersQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Filtrar por rol global',
        example: 'admin',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], AdminListUsersQueryDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Filtrar por estado activo',
        example: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => toBoolean(value)),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AdminListUsersQueryDto.prototype, "active", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Filtrar por unión (solo intersección con scope del actor)',
        example: 12,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AdminListUsersQueryDto.prototype, "unionId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Filtrar por campo local (solo intersección con scope del actor)',
        example: 34,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AdminListUsersQueryDto.prototype, "localFieldId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Número de página (1-indexed)',
        minimum: 1,
        default: 1,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AdminListUsersQueryDto.prototype, "page", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Cantidad de elementos por página',
        minimum: 1,
        maximum: 100,
        default: 20,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], AdminListUsersQueryDto.prototype, "limit", void 0);
//# sourceMappingURL=users.dto.js.map