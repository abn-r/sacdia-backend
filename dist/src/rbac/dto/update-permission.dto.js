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
exports.UpdatePermissionDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UpdatePermissionDto {
    permission_name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { permission_name: { required: false, type: () => String, maxLength: 255, pattern: "/^[a-z_]+:[a-z_]+$/" }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdatePermissionDto = UpdatePermissionDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'users:read_detail' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    (0, class_validator_1.Matches)(/^[a-z_]+:[a-z_]+$/, {
        message: 'permission_name debe seguir el formato resource:action (lowercase, separado por :)',
    }),
    __metadata("design:type", String)
], UpdatePermissionDto.prototype, "permission_name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Ver detalle de un usuario' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePermissionDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], UpdatePermissionDto.prototype, "active", void 0);
//# sourceMappingURL=update-permission.dto.js.map