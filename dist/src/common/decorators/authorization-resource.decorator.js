"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTHORIZATION_RESOURCE_KEY = void 0;
exports.AuthorizationResource = AuthorizationResource;
const common_1 = require("@nestjs/common");
exports.AUTHORIZATION_RESOURCE_KEY = 'authorization_resource';
function AuthorizationResource(resource) {
    return (0, common_1.SetMetadata)(exports.AUTHORIZATION_RESOURCE_KEY, resource);
}
//# sourceMappingURL=authorization-resource.decorator.js.map