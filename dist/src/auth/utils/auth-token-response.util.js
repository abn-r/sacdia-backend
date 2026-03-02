"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuthTokenResponse = buildAuthTokenResponse;
function buildAuthTokenResponse(payload) {
    const response = {
        accessToken: payload.accessToken,
    };
    if (payload.refreshToken !== undefined) {
        response.refreshToken = payload.refreshToken;
    }
    if (payload.expiresAt !== undefined) {
        response.expiresAt = payload.expiresAt;
    }
    if (payload.tokenType !== undefined) {
        response.tokenType = payload.tokenType ?? 'bearer';
    }
    return response;
}
//# sourceMappingURL=auth-token-response.util.js.map