import { JwtService } from '@nestjs/jwt';
import {
  ACCEPTED_BEARER_AUDIENCES,
  ACCESS_JWT_ISSUER,
  QR_MEMBER_AUDIENCE,
  isAccessJwtClaims,
  isDeviceJwtClaims,
  jwtAudienceIncludes,
} from '../common/constants/jwt-audiences';

/**
 * True when `token` is an HS256 SACDIA access JWT, or a linked-device JWT
 * (aud = sacdia:device), for `expectedUserId`. A device refresh therefore
 * blacklists the previous device token like any access refresh.
 * Expired signatures still count — refresh often happens after a 401.
 * QR audience, wrong secret, or another subject → false. Never throws.
 *
 * Uses `@nestjs/jwt` (declared dependency) instead of importing
 * `jsonwebtoken` directly — that package is only transitive and breaks
 * `nest build` without `@types/jsonwebtoken` on the root.
 */
export function isPresentedAccessJwtForUser(
  token: string,
  expectedUserId: string,
  secret: string,
): boolean {
  if (!token || !expectedUserId || !secret) {
    return false;
  }

  try {
    const jwtService = new JwtService({ secret });
    const payload = jwtService.verify<{
      sub?: string;
      aud?: unknown;
      iss?: unknown;
    }>(token, {
      algorithms: ['HS256'],
      issuer: ACCESS_JWT_ISSUER,
      audience: ACCEPTED_BEARER_AUDIENCES,
      ignoreExpiration: true,
    });

    if (typeof payload.sub !== 'string') {
      return false;
    }

    if (jwtAudienceIncludes(payload.aud, QR_MEMBER_AUDIENCE)) {
      return false;
    }

    if (!isAccessJwtClaims(payload) && !isDeviceJwtClaims(payload)) {
      return false;
    }

    return payload.sub === expectedUserId;
  } catch {
    return false;
  }
}
