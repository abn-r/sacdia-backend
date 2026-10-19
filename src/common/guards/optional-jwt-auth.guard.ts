import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isActingForError } from '../../auth/acting-for/acting-for.errors';
import { isActingScopeAllowed } from '../../auth/acting-for/acting-scope.policy';
import { isRevocationCheckUnavailable } from './jwt-auth.guard';

/**
 * Guard JWT opcional para endpoints públicos:
 * - Si hay token válido, adjunta request.user
 * - Si no hay token o es inválido/expirado, continúa como anónimo
 * - Si hay token pero NO se pudo verificar su revocación (503
 *   AUTH_REVOCATION_CHECK_UNAVAILABLE), propaga el 503: tratar una petición
 *   autenticada como anónima serviría contenido distinto/público a un usuario
 *   que sí inició sesión (y podría ocultar datos propios sin avisar).
 * - Errores de X-Acting-For (400/403) se propagan: nunca se degradan a anónimo.
 * - Un principal sustituido (tutor actuando por un dependiente) en una ruta sin
 *   @ActingScope se degrada a anónimo: son rutas públicas, así que es el menor
 *   privilegio y mantiene funcionando los catálogos del paso 3.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    _info: any,
    context: ExecutionContext,
    _status?: any,
  ): TUser {
    if (isRevocationCheckUnavailable(err) || isActingForError(err)) {
      throw err;
    }

    if (err || !user) {
      return null as TUser;
    }

    if (!isActingScopeAllowed(this.reflector, context, user)) {
      return null as TUser;
    }

    return user as TUser;
  }
}
