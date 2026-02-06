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
exports.OAuthCallbackDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class OAuthCallbackDto {
    access_token;
    refresh_token;
    provider;
    static _OPENAPI_METADATA_FACTORY() {
        return { access_token: { required: true, type: () => String }, refresh_token: { required: false, type: () => String }, provider: { required: false, type: () => String } };
    }
}
exports.OAuthCallbackDto = OAuthCallbackDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Access token de Supabase Auth',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], OAuthCallbackDto.prototype, "access_token", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Refresh token de Supabase',
        example: 'v1.abc123...',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OAuthCallbackDto.prototype, "refresh_token", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Provider utilizado (google, apple)',
        example: 'google',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OAuthCallbackDto.prototype, "provider", void 0);
//# sourceMappingURL=oauth-callback.dto.js.map