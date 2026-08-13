import { ExecutionContext, Injectable } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * APP_GUARD variant of JwtAuthGuard: deny-by-default JWT auth for every
 * route, with an escape hatch via @Public().
 *
 * Split from JwtAuthGuard on purpose: only the GLOBAL guard honors
 * @Public(). A route-level @UseGuards(JwtAuthGuard) keeps enforcing auth
 * even inside a controller marked @Public() at class level (pattern used
 * by catalog-style controllers that pair class-level @Public() +
 * OptionalJwtAuthGuard with a few JWT-only routes).
 */
@Injectable()
export class GlobalJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
