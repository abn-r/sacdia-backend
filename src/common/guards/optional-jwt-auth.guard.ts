import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isRevocationCheckUnavailable } from './jwt-auth.guard';

/**
 * Guard JWT opcional para endpoints públicos:
 * - Si hay token válido, adjunta request.user
 * - Si no hay token o es inválido/expirado, continúa como anónimo
 * - Si hay token pero NO se pudo verificar su revocación (503
 *   AUTH_REVOCATION_CHECK_UNAVAILABLE), propaga el 503: tratar una petición
 *   autenticada como anónima serviría contenido distinto/público a un usuario
 *   que sí inició sesión (y podría ocultar datos propios sin avisar).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    _info: any,
    _context: ExecutionContext,
    _status?: any,
  ): TUser {
    if (isRevocationCheckUnavailable(err)) {
      throw err;
    }

    if (err || !user) {
      return null as TUser;
    }

    return user as TUser;
  }
}
