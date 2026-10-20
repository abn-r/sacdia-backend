import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../config/throttler.helpers';
import { ActingScope } from './acting-for/acting-scope.decorator';

/**
 * OAuthController — connected providers.
 *
 * Sign-in lives in SocialSignInController (`POST /auth/oauth/:provider/token`).
 * This controller only lists and unlinks providers for the authenticated user.
 */
@ApiTags('OAuth')
@Controller('auth/oauth')
@SkipPermissions()
// Auth-grade: 5/min on every OAuth route. JWT routes key by user.
@Throttle(namedThrottle({ ttl: 60000, limit: 5 }))
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ---------------------------------------------------------------------------
  // Connected providers
  // ---------------------------------------------------------------------------

  @Get('providers')
  // An unknown-age account deleting itself must re-authenticate with its
  // provider: the app lists the linked providers first (App Store 5.1.1(v)).
  @ActingScope('account:manage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener providers OAuth conectados',
    description:
      'Retorna un array con los nombres de los providers OAuth (google, apple) ' +
      'conectados al usuario. Fuente de verdad: tabla `accounts` (Better Auth). ' +
      'El provider "credential" (email+password) es excluido.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de providers conectados',
    schema: {
      example: ['google'],
    },
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async getConnectedProviders(@Request() req) {
    return this.oauthService.getConnectedProviders(req.user.user_id);
  }

  // ---------------------------------------------------------------------------
  // Disconnect provider
  // ---------------------------------------------------------------------------

  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Desconectar un provider OAuth',
    description:
      'Elimina la conexión OAuth (fila en tabla `accounts`) para el provider dado. ' +
      'A diferencia de Supabase (que solo actualizaba un flag), esto REALMENTE ' +
      'desvincula el provider. ' +
      'Falla si es el único método de autenticación del usuario.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Provider a desconectar',
    enum: ['google', 'apple'],
  })
  @ApiResponse({
    status: 200,
    description: 'Provider desconectado',
    schema: {
      example: {
        success: true,
        message: 'Provider desconectado exitosamente',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Provider inválido o no conectado' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async disconnectProvider(
    @Param('provider') provider: string,
    @Request() req,
  ) {
    return this.oauthService.disconnectProvider(req.user.user_id, provider);
  }
}
