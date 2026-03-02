export interface AuthTokenPayload {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    tokenType?: string | null;
}
export interface AuthTokenResponse {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    tokenType?: string;
}
export declare function buildAuthTokenResponse(payload: AuthTokenPayload): AuthTokenResponse;
