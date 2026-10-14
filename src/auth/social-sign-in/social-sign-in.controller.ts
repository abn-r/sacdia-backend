import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { namedThrottle } from '../../config/throttler.helpers';
import { SocialTokenSignInDto } from './dto/social-token-sign-in.dto';
import { SocialSignInService } from './social-sign-in.service';
import { SOCIAL_PROVIDERS, isSocialProvider } from './social-sign-in.types';

/**
 * Native social sign-in for the mobile app.
 *
 * The app obtains an id token from the Google / Apple SDK and posts it here.
 * No browser redirect, no Better Auth callback.
 */
@ApiTags('OAuth')
@Controller('auth/oauth')
@SkipPermissions()
// Auth-grade: same 5/min budget as login, keyed by IP (public route).
@Throttle(namedThrottle({ ttl: 60000, limit: 5 }))
export class SocialSignInController {
  constructor(private readonly socialSignIn: SocialSignInService) {}

  @Public()
  @Post(':provider/token')
  @ApiOperation({
    summary: 'Iniciar sesión con un id token nativo de Google o Apple',
    description:
      'La app obtiene el idToken con el SDK nativo y lo envía junto con el nonce. ' +
      'El backend verifica firma, emisor, audiencia, expiración y nonce; crea o vincula ' +
      'el usuario; y devuelve el JWT de SACDIA envuelto como /auth/login ({ status, data }).',
  })
  @ApiParam({ name: 'provider', enum: [...SOCIAL_PROVIDERS] })
  @ApiResponse({
    status: 201,
    description: 'Sesión creada',
    schema: {
      example: {
        status: 'success',
        data: {
          accessToken: 'eyJhbGc...',
          sessionToken: 'opaque_session_token',
          refreshToken: 'opaque_session_token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
          user: {
            id: 'uuid-123',
            email: 'user@gmail.com',
            name: 'Juan',
            paternal_last_name: 'Pérez',
            maternal_last_name: null,
            avatar: 'https://r2.sacdia.app/profiles/...',
            connectedProviders: ['google'],
          },
          needsPostRegistration: true,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Proveedor inválido' })
  @ApiResponse({
    status: 401,
    description: 'Token inválido o correo no verificado',
  })
  @ApiResponse({ status: 503, description: 'JWKS del proveedor no disponible' })
  async signIn(
    @Param('provider') provider: string,
    @Body() dto: SocialTokenSignInDto,
  ) {
    if (!isSocialProvider(provider)) {
      throw new AppBadRequestException(ErrorCode.AUTH_OAUTH_PROVIDER_INVALID, {
        provider,
        valid: SOCIAL_PROVIDERS.join(', '),
      });
    }
    // No global response wrapper exists: wrap by hand, like AuthService.login.
    return {
      status: 'success' as const,
      data: await this.socialSignIn.signIn(provider, dto),
    };
  }
}
