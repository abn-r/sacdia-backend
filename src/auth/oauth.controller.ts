import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { OAuthInitiateDto } from './dto/oauth-initiate.dto';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/**
 * OAuthController — Better Auth edition (W3-008 Part 3)
 *
 * ## Endpoint changes from Supabase → BA
 *
 * | Old (Supabase)                          | New (BA)                               |
 * |-----------------------------------------|----------------------------------------|
 * | GET  /auth/oauth/callback?access_token= | POST /auth/oauth/callback (body)       |
 * | GET  /auth/oauth/providers → { google_connected: bool, ... } | GET /auth/oauth/providers → string[] |
 * | DELETE /auth/oauth/:provider (flag-only) | DELETE /auth/oauth/:provider (real delete) |
 *
 * ## OAuth flow (browser-facing BA callback)
 *
 * 1. Client POSTs to `POST /auth/oauth/google` or `POST /auth/oauth/apple`.
 * 2. Server returns `{ url }` — client redirects browser there.
 * 3. Provider authenticates user and redirects to BA callback:
 *    `GET {BETTER_AUTH_BASE_URL}/api/auth/callback/{provider}?code=...&state=...`
 * 4. BA processes the exchange, creates/updates `users` + `accounts` rows,
 *    sets a `better-auth.session_token` cookie, and redirects to `callbackURL`.
 * 5. Client reads the session token from the cookie and POSTs it to
 *    `POST /auth/oauth/callback` to receive a SACDIA HS256 JWT.
 */
@ApiTags('OAuth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ---------------------------------------------------------------------------
  // OAuth initiation
  // ---------------------------------------------------------------------------

  @Post('google')
  @ApiResponse({ status: 400, description: 'Redirect URL inválida o faltante' })
  @ApiOperation({
    summary: 'Iniciar autenticación con Google',
    description:
      'Retorna la URL de autorización de Google. ' +
      'El cliente debe redirigir el browser del usuario a esta URL. ' +
      'Better Auth maneja el code exchange en su callback interno.',
  })
  @ApiResponse({
    status: 201,
    description: 'URL de OAuth generada',
    schema: {
      example: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Error al generar URL de OAuth' })
  async googleSignIn(@Body() dto: OAuthInitiateDto) {
    return this.oauthService.initiateGoogleSignIn(dto.redirectUrl);
  }

  @Post('apple')
  @ApiResponse({ status: 400, description: 'Redirect URL inválida o faltante' })
  @ApiOperation({
    summary: 'Iniciar autenticación con Apple',
    description:
      'Retorna la URL de autorización de Apple. ' +
      'El cliente debe redirigir el browser del usuario a esta URL. ' +
      'Better Auth maneja el code exchange en su callback interno.',
  })
  @ApiResponse({
    status: 201,
    description: 'URL de OAuth generada',
    schema: {
      example: {
        url: 'https://appleid.apple.com/auth/authorize?client_id=...',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Error al generar URL de OAuth' })
  async appleSignIn(@Body() dto: OAuthInitiateDto) {
    return this.oauthService.initiateAppleSignIn(dto.redirectUrl);
  }

  // ---------------------------------------------------------------------------
  // OAuth callback finalisation
  // ---------------------------------------------------------------------------

  @Post('callback')
  @ApiOperation({
    summary: 'Finalizar callback de OAuth',
    description:
      'Finaliza el flujo OAuth después de que Better Auth procesó el code exchange. ' +
      'El cliente envía el opaque session token (de la cookie `better-auth.session_token` ' +
      'o del fragment de la callbackURL). ' +
      'Retorna un SACDIA JWT (HS256) listo para usar como Bearer token.',
  })
  @ApiResponse({
    status: 201,
    description: 'Autenticación OAuth exitosa',
    schema: {
      example: {
        accessToken: 'eyJhbGc...',
        sessionToken: 'ba_opaque_session_token',
        user: {
          id: 'uuid-123',
          email: 'user@gmail.com',
          name: 'Juan',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'González',
          avatar: 'https://r2.sacdia.app/profiles/...',
          connectedProviders: ['google'],
        },
        needsPostRegistration: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Session token inválido o expirado',
  })
  async handleCallback(@Body() dto: OAuthCallbackDto) {
    return this.oauthService.handleCallback(dto);
  }

  // ---------------------------------------------------------------------------
  // Connected providers
  // ---------------------------------------------------------------------------

  @Get('providers')
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
