"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSIONS_KEY = void 0;
exports.RequirePermissions = RequirePermissions;
const common_1 = require("@nestjs/common");
exports.PERMISSIONS_KEY = 'permissions';
function RequirePermissions(...args) {
    const requirement = typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0]
        : {
            permissions: args,
            mode: 'all',
        };
    return (0, common_1.SetMetadata)(exports.PERMISSIONS_KEY, requirement);
}
//# sourceMappingURL=permissions.decorator.js.map