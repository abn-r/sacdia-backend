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
exports.UpdateCertificationProgressDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UpdateCertificationProgressDto {
    module_id;
    section_id;
    completed;
    static _OPENAPI_METADATA_FACTORY() {
        return { module_id: { required: true, type: () => Number, minimum: 1 }, section_id: { required: true, type: () => Number, minimum: 1 }, completed: { required: true, type: () => Boolean } };
    }
}
exports.UpdateCertificationProgressDto = UpdateCertificationProgressDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del módulo de la certificación',
        example: 1,
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsPositive)(),
    __metadata("design:type", Number)
], UpdateCertificationProgressDto.prototype, "module_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID de la sección del módulo',
        example: 1,
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsPositive)(),
    __metadata("design:type", Number)
], UpdateCertificationProgressDto.prototype, "section_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Estado de completado de la sección',
        example: true,
    }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateCertificationProgressDto.prototype, "completed", void 0);
//# sourceMappingURL=update-progress.dto.js.map