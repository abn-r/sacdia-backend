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
exports.CreateEmergencyContactDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateEmergencyContactDto {
    name;
    relationship_type_id;
    phone;
    primary;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 100 }, relationship_type_id: { required: true, type: () => String, format: "uuid" }, phone: { required: true, type: () => String, maxLength: 20 }, primary: { required: false, type: () => Boolean } };
    }
}
exports.CreateEmergencyContactDto = CreateEmergencyContactDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'María García López' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateEmergencyContactDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '11111111-1111-1111-1111-111111111111',
        description: 'UUID del tipo de relación',
    }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateEmergencyContactDto.prototype, "relationship_type_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '+52 55 1234 5678' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], CreateEmergencyContactDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: true,
        description: 'Si es el contacto principal',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateEmergencyContactDto.prototype, "primary", void 0);
//# sourceMappingURL=create-emergency-contact.dto.js.map