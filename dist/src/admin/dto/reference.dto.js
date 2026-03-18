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
exports.UpdateEcclesiasticalYearDto = exports.CreateEcclesiasticalYearDto = exports.UpdateMedicineDto = exports.CreateMedicineDto = exports.UpdateDiseaseDto = exports.CreateDiseaseDto = exports.UpdateAllergyDto = exports.CreateAllergyDto = exports.UpdateRelationshipTypeDto = exports.CreateRelationshipTypeDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class CreateRelationshipTypeDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 50 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateRelationshipTypeDto = CreateRelationshipTypeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Padre' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateRelationshipTypeDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Relación padre-hijo' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRelationshipTypeDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRelationshipTypeDto.prototype, "active", void 0);
class UpdateRelationshipTypeDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 50 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateRelationshipTypeDto = UpdateRelationshipTypeDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Padre' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateRelationshipTypeDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Relación padre-hijo' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateRelationshipTypeDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateRelationshipTypeDto.prototype, "active", void 0);
class CreateAllergyDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateAllergyDto = CreateAllergyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Polen' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateAllergyDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Alergia estacional al polen' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAllergyDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateAllergyDto.prototype, "active", void 0);
class UpdateAllergyDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateAllergyDto = UpdateAllergyDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Polen' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateAllergyDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Alergia estacional al polen' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAllergyDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAllergyDto.prototype, "active", void 0);
class CreateDiseaseDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateDiseaseDto = CreateDiseaseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Asma' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateDiseaseDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Enfermedad respiratoria crónica' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateDiseaseDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateDiseaseDto.prototype, "active", void 0);
class UpdateDiseaseDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateDiseaseDto = UpdateDiseaseDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Asma' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateDiseaseDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Enfermedad respiratoria crónica' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateDiseaseDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateDiseaseDto.prototype, "active", void 0);
class CreateMedicineDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateMedicineDto = CreateMedicineDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Ibuprofeno' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateMedicineDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Analgésico antiinflamatorio' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateMedicineDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateMedicineDto.prototype, "active", void 0);
class UpdateMedicineDto {
    name;
    description;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 100 }, description: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateMedicineDto = UpdateMedicineDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Ibuprofeno' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateMedicineDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Analgésico antiinflamatorio' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateMedicineDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateMedicineDto.prototype, "active", void 0);
class CreateEcclesiasticalYearDto {
    start_date;
    end_date;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { start_date: { required: true, type: () => String }, end_date: { required: true, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.CreateEcclesiasticalYearDto = CreateEcclesiasticalYearDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2026-01-01' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateEcclesiasticalYearDto.prototype, "start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2026-12-31' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateEcclesiasticalYearDto.prototype, "end_date", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateEcclesiasticalYearDto.prototype, "active", void 0);
class UpdateEcclesiasticalYearDto {
    start_date;
    end_date;
    active;
    static _OPENAPI_METADATA_FACTORY() {
        return { start_date: { required: false, type: () => String }, end_date: { required: false, type: () => String }, active: { required: false, type: () => Boolean } };
    }
}
exports.UpdateEcclesiasticalYearDto = UpdateEcclesiasticalYearDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '2026-01-01' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateEcclesiasticalYearDto.prototype, "start_date", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '2026-12-31' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateEcclesiasticalYearDto.prototype, "end_date", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateEcclesiasticalYearDto.prototype, "active", void 0);
//# sourceMappingURL=reference.dto.js.map