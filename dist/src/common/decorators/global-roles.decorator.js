"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalRoles = exports.GLOBAL_ROLES_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.GLOBAL_ROLES_KEY = 'global_roles';
const GlobalRoles = (...roles) => (0, common_1.SetMetadata)(exports.GLOBAL_ROLES_KEY, roles);
exports.GlobalRoles = GlobalRoles;
//# sourceMappingURL=global-roles.decorator.js.map