/**
 * JWT audiences / issuer issued by SACDIA.
 *
 * Access JWTs: iss=https://api.sacdia.app aud=sacdia:access
 * QR member tokens: QR_JWT_SECRET + aud=sacdia:qr-member
 * JwtStrategy rejects anything that is not an access claim set.
 */
export const ACCESS_JWT_ISSUER = 'https://api.sacdia.app';
export const ACCESS_JWT_AUDIENCE = 'sacdia:access';
export const QR_MEMBER_AUDIENCE = 'sacdia:qr-member';

export function jwtAudienceIncludes(
  aud: unknown,
  expected: string,
): boolean {
  if (aud === expected) {
    return true;
  }
  return Array.isArray(aud) && aud.includes(expected);
}

export function accessJwtClaims(): {
  iss: typeof ACCESS_JWT_ISSUER;
  aud: typeof ACCESS_JWT_AUDIENCE;
} {
  return {
    iss: ACCESS_JWT_ISSUER,
    aud: ACCESS_JWT_AUDIENCE,
  };
}

export function isAccessJwtClaims(payload: {
  aud?: unknown;
  iss?: unknown;
}): boolean {
  return (
    payload.iss === ACCESS_JWT_ISSUER &&
    jwtAudienceIncludes(payload.aud, ACCESS_JWT_AUDIENCE)
  );
}
