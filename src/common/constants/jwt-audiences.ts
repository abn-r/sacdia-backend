/**
 * JWT audiences / issuer issued by SACDIA.
 *
 * Access JWTs: iss=https://api.sacdia.app aud=sacdia:access
 * Device JWTs (Phase 3b, a child's paired phone): same issuer, aud=sacdia:device,
 * a SINGLE string audience. They are minted only by the device pairing / refresh
 * paths and authenticate the `linked_device` principal.
 * QR member tokens: QR_JWT_SECRET + aud=sacdia:qr-member
 * JwtStrategy rejects anything that is neither an access nor a device claim set.
 */
export const ACCESS_JWT_ISSUER = 'https://api.sacdia.app';
export const ACCESS_JWT_AUDIENCE = 'sacdia:access';
export const QR_MEMBER_AUDIENCE = 'sacdia:qr-member';
/**
 * The linked device (a child's paired phone), Phase 3b. The strategy accepts it
 * together with ACCESS_JWT_AUDIENCE through an audience ARRAY option, then tells
 * the two apart by the claim set: a token carrying BOTH, or the device audience
 * as an array, is rejected.
 */
export const DEVICE_AUDIENCE = 'sacdia:device';

/** Audiences the Passport verifier accepts; `validate` decides what each one is. */
export const ACCEPTED_BEARER_AUDIENCES: [string, string] = [
  ACCESS_JWT_AUDIENCE,
  DEVICE_AUDIENCE,
];

export function jwtAudienceIncludes(aud: unknown, expected: string): boolean {
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

export function deviceJwtClaims(): {
  iss: typeof ACCESS_JWT_ISSUER;
  aud: typeof DEVICE_AUDIENCE;
} {
  return {
    iss: ACCESS_JWT_ISSUER,
    aud: DEVICE_AUDIENCE,
  };
}

/**
 * True only for a device claim set: our issuer and `aud` EXACTLY the string
 * 'sacdia:device'. An audience array (even ["sacdia:device"]) is not a device
 * token, and neither is one that also lists the access audience.
 */
export function isDeviceJwtClaims(payload: {
  aud?: unknown;
  iss?: unknown;
}): boolean {
  return payload.iss === ACCESS_JWT_ISSUER && payload.aud === DEVICE_AUDIENCE;
}
