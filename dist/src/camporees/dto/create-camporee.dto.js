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
exports.CreateCamporeeDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateCamporeeDto {
    name;
    description;
    start_date;
    end_date;
    local_field_id;
    includes_adventurers;
    includes_pathfinders;
    includes_master_guides;
    local_camporee_place;
    registration_cost;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 255 }, description: { required: false, type: () => String, maxLength: 1000 }, start_date: { required: true, type: () => String }, end_date: { required: true, type: () => String }, local_field_id: { required: true, type: () => Number }, includes_adventurers: { required: true, type: () => Boolean }, includes_pathfinders: { required: true, type: () => Boolean }, includes_master_guides: { required: true, type: () => Boolean }, local_camporee_place: { required: true, type: () => String, maxLength: 255 }, registration_cost: { required: false, type: () => Number, minimum: 0 } };
    }
}
exports.CreateCamporeeDto = CreateCamporeeDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Nombre del camporee',
        example: 'Camporee de Primavera 2024',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateCamporeeDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Descripción detallada del camporee',
        example: 'Evento anual de primavera con actividades para todas las edades',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], CreateCamporeeDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Fecha de inicio del camporee (formato ISO 8601)',
        example: '2024-05-15',
    }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateCamporeeDto.prototype, "start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Fecha de finalización del camporee (formato ISO 8601)',
        example: '2024-05-17',
    }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateCamporeeDto.prototype, "end_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del campo local organizador',
        example: 1,
    }),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], CreateCamporeeDto.prototype, "local_field_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Indica si incluye participantes de Aventureros',
        example: true,
    }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateCamporeeDto.prototype, "includes_adventurers", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Indica si incluye participantes de Conquistadores',
        example: true,
    }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateCamporeeDto.prototype, "includes_pathfinders", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Indica si incluye participantes de Guías Mayores',
        example: true,
    }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateCamporeeDto.prototype, "includes_master_guides", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Lugar donde se realizará el camporee',
        example: 'Centro Recreacional La Montaña, Bogotá',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateCamporeeDto.prototype, "local_camporee_place", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Costo de inscripción al camporee (en moneda local)',
        example: 50000,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({ maxDecimalPlaces: 2 }),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateCamporeeDto.prototype, "registration_cost", void 0);
//# sourceMappingURL=create-camporee.dto.js.map