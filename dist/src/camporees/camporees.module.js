"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CamporeesModule = void 0;
const common_1 = require("@nestjs/common");
const camporees_controller_1 = require("./camporees.controller");
const camporees_service_1 = require("./camporees.service");
const prisma_module_1 = require("../prisma/prisma.module");
const guards_1 = require("../common/guards");
let CamporeesModule = class CamporeesModule {
};
exports.CamporeesModule = CamporeesModule;
exports.CamporeesModule = CamporeesModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [camporees_controller_1.CamporeesController],
        providers: [camporees_service_1.CamporeesService, guards_1.ClubRolesGuard],
        exports: [camporees_service_1.CamporeesService],
    })
], CamporeesModule);
//# sourceMappingURL=camporees.module.js.map