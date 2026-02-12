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
exports.CreatePermissionDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreatePermissionDto {
    permission_name;
    description;
    static _OPENAPI_METADATA_FACTORY() {
        return { permission_name: { required: true, type: () => String, maxLength: 255, pattern: "/^[a-z_]+:[a-z_]+$/" }, description: { required: false, type: () => String } };
    }
}
exports.CreatePermissionDto = CreatePermissionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'users:read', description: 'Nombre del permiso (resource:action)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(255),
    (0, class_validator_1.Matches)(/^[a-z_]+:[a-z_]+$/, {
        message: 'permission_name debe seguir el formato resource:action (lowercase, separado por :)',
    }),
    __metadata("design:type", String)
], CreatePermissionDto.prototype, "permission_name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Ver listado de usuarios' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreatePermissionDto.prototype, "description", void 0);
//# sourceMappingURL=create-permission.dto.js.map