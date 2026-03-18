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
exports.UpdateChurchDto = exports.CreateChurchDto = exports.UpdateDistrictDto = exports.CreateDistrictDto = exports.UpdateLocalFieldDto = exports.CreateLocalFieldDto = exports.UpdateUnionDto = exports.CreateUnionDto = exports.UpdateCountryDto = exports.CreateCountryDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class CreateCountryDto {
    name;
    abbreviation;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, abbreviation: { required: true, type: () => String, maxLength: 8 }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateCountryDto = CreateCountryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'México' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateCountryDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'MX' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], CreateCountryDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateCountryDto.prototype, "active", void 0);
class UpdateCountryDto {
    name;
    abbreviation;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, abbreviation: { required: false, type: () => String, maxLength: 8 }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateCountryDto = UpdateCountryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'México' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateCountryDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'MX' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], UpdateCountryDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateCountryDto.prototype, "active", void 0);
class CreateUnionDto {
    name;
    abbreviation;
    country_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, abbreviation: { required: true, type: () => String, maxLength: 8 }, country_id: { required: true, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateUnionDto = CreateUnionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Unión Mexicana del Norte' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateUnionDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'UMN' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], CreateUnionDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateUnionDto.prototype, "country_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateUnionDto.prototype, "active", void 0);
class UpdateUnionDto {
    name;
    abbreviation;
    country_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, abbreviation: { required: false, type: () => String, maxLength: 8 }, country_id: { required: false, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateUnionDto = UpdateUnionDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Unión Mexicana del Norte' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateUnionDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'UMN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], UpdateUnionDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateUnionDto.prototype, "country_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateUnionDto.prototype, "active", void 0);
class CreateLocalFieldDto {
    name;
    abbreviation;
    union_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, abbreviation: { required: true, type: () => String, maxLength: 8 }, union_id: { required: true, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateLocalFieldDto = CreateLocalFieldDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Campo Norte' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateLocalFieldDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'CN' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], CreateLocalFieldDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateLocalFieldDto.prototype, "union_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateLocalFieldDto.prototype, "active", void 0);
class UpdateLocalFieldDto {
    name;
    abbreviation;
    union_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, abbreviation: { required: false, type: () => String, maxLength: 8 }, union_id: { required: false, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateLocalFieldDto = UpdateLocalFieldDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Campo Norte' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateLocalFieldDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'CN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], UpdateLocalFieldDto.prototype, "abbreviation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateLocalFieldDto.prototype, "union_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateLocalFieldDto.prototype, "active", void 0);
class CreateDistrictDto {
    name;
    local_field_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, local_field_id: { required: true, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateDistrictDto = CreateDistrictDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Distrito Norte' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateDistrictDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateDistrictDto.prototype, "local_field_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateDistrictDto.prototype, "active", void 0);
class UpdateDistrictDto {
    name;
    local_field_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, local_field_id: { required: false, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateDistrictDto = UpdateDistrictDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Distrito Norte' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateDistrictDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateDistrictDto.prototype, "local_field_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateDistrictDto.prototype, "active", void 0);
class CreateChurchDto {
    name;
    district_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, district_id: { required: true, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateChurchDto = CreateChurchDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Iglesia Central' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateChurchDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateChurchDto.prototype, "district_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateChurchDto.prototype, "active", void 0);
class UpdateChurchDto {
    name;
    district_id;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, district_id: { required: false, type: () => Number, minimum: 1 }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateChurchDto = UpdateChurchDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Iglesia Central' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateChurchDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateChurchDto.prototype, "district_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateChurchDto.prototype, "active", void 0);
//# sourceMappingURL=geography.dto.js.map