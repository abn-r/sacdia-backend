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
exports.RegisterMemberDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class RegisterMemberDto {
    user_id;
    camporee_type;
    club_name;
    insurance_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { user_id: { required: true, type: () => String, format: "uuid" }, camporee_type: { required: true, type: () => Object, enum: ['local', 'union'], maxLength: 50 }, club_name: { required: false, type: () => String, maxLength: 255 }, insurance_id: { required: false, type: () => Number } };
    }
}
exports.RegisterMemberDto = RegisterMemberDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del usuario a registrar',
        example: 'user-uuid-here',
    }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RegisterMemberDto.prototype, "user_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Tipo de camporee (local o unión)',
        example: 'local',
        enum: ['local', 'union'],
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['local', 'union']),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], RegisterMemberDto.prototype, "camporee_type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Nombre del club (requerido para registros de nivel unión)',
        example: 'Club Conquistadores Central',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], RegisterMemberDto.prototype, "club_name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'ID del seguro del miembro (referencia a member_insurances)',
        example: 123,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], RegisterMemberDto.prototype, "insurance_id", void 0);
//# sourceMappingURL=register-member.dto.js.map