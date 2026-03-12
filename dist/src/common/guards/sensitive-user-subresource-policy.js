"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSensitiveUserSubresourcePolicy = getSensitiveUserSubresourcePolicy;
exports.getSensitiveUserSubresourceFallbackPermission = getSensitiveUserSubresourceFallbackPermission;
const LEGACY_PERMISSION_BY_MODE = {
    read: 'users:read_detail',
    update: 'users:update',
};
function getSensitiveUserSubresourcePolicy(family, mode) {
    return {
        finePermission: `${family}:${mode}`,
        legacyFallbackPermission: LEGACY_PERMISSION_BY_MODE[mode],
    };
}
function getSensitiveUserSubresourceFallbackPermission(family, mode) {
    return getSensitiveUserSubresourcePolicy(family, mode).legacyFallbackPermission;
}
//# sourceMappingURL=sensitive-user-subresource-policy.js.map