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
exports.UpdateItemDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UpdateItemDto {
    name;
    description;
    inventory_category_id;
    amount;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, minLength: 3, maxLength: 100 }, description: { required: false, type: () => String, maxLength: 500 }, inventory_category_id: { required: false, type: () => Number, minimum: 1 }, amount: { required: false, type: () => Number, minimum: 0 } };
    }
}
exports.UpdateItemDto = UpdateItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Nombre del item',
        example: 'Carpas 4 personas',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateItemDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Descripción detallada del item',
        example: 'Carpas marca Coleman para 4 personas',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], UpdateItemDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID de la categoría de inventario',
        example: 1,
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsPositive)(),
    __metadata("design:type", Number)
], UpdateItemDto.prototype, "inventory_category_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Cantidad disponible',
        example: 8,
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], UpdateItemDto.prototype, "amount", void 0);
//# sourceMappingURL=update-item.dto.js.map