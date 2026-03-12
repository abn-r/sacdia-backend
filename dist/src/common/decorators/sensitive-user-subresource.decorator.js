"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENSITIVE_USER_SUBRESOURCE_KEY = void 0;
exports.SensitiveUserSubresource = SensitiveUserSubresource;
const common_1 = require("@nestjs/common");
const authorization_resource_decorator_1 = require("./authorization-resource.decorator");
const permissions_decorator_1 = require("./permissions.decorator");
const sensitive_user_subresource_policy_1 = require("../guards/sensitive-user-subresource-policy");
exports.SENSITIVE_USER_SUBRESOURCE_KEY = 'sensitive_user_subresource';
function SensitiveUserSubresource(family, mode, options) {
    const policy = (0, sensitive_user_subresource_policy_1.getSensitiveUserSubresourcePolicy)(family, mode);
    return (0, common_1.applyDecorators)((0, common_1.SetMetadata)(exports.SENSITIVE_USER_SUBRESOURCE_KEY, { family, mode }), (0, permissions_decorator_1.RequirePermissions)(policy.finePermission), (0, authorization_resource_decorator_1.AuthorizationResource)({
        type: 'user',
        ownerParam: options?.ownerParam ?? 'userId',
    }));
}
//# sourceMappingURL=sensitive-user-subresource.decorator.js.map