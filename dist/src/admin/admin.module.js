"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const admin_geography_controller_1 = require("./admin-geography.controller");
const admin_reference_controller_1 = require("./admin-reference.controller");
const admin_users_controller_1 = require("./admin-users.controller");
const admin_geography_service_1 = require("./admin-geography.service");
const admin_reference_service_1 = require("./admin-reference.service");
const admin_users_service_1 = require("./admin-users.service");
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [
            admin_geography_controller_1.AdminGeographyController,
            admin_reference_controller_1.AdminReferenceController,
            admin_users_controller_1.AdminUsersController,
        ],
        providers: [admin_geography_service_1.AdminGeographyService, admin_reference_service_1.AdminReferenceService, admin_users_service_1.AdminUsersService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map