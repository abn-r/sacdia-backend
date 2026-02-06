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
exports.UpdateSectionRecordDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UpdateSectionRecordDto {
    points;
    evidences;
    static _OPENAPI_METADATA_FACTORY() {
        return { points: { required: true, type: () => Number, minimum: 0 }, evidences: { required: true, type: () => Object } };
    }
}
exports.UpdateSectionRecordDto = UpdateSectionRecordDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Puntos obtenidos en la sección (máximo definido en el template)',
        example: 10,
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], UpdateSectionRecordDto.prototype, "points", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Evidencias en formato JSON flexible',
        example: {
            photos: ['url1.jpg', 'url2.jpg'],
            description: 'Completó la actividad exitosamente',
            verified_by: 'Director Juan Pérez',
            date: '2026-02-10',
        },
    }),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateSectionRecordDto.prototype, "evidences", void 0);
//# sourceMappingURL=update-section-record.dto.js.map