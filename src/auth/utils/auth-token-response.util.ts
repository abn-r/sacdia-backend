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

export function buildAuthTokenResponse(
  payload: AuthTokenPayload,
): AuthTokenResponse {
  const response: AuthTokenResponse = {
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
