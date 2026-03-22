import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { OAuthInitiateDto } from './dto/oauth-initiate.dto';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('OAuth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Post('google')
  @ApiOperation({
    summary: 'Iniciar autenticación con Google',
    description:
      'Retorna URL de OAuth de Google. Frontend debe redirigir al usuario a esta URL.',
  })
  @ApiResponse({
    status: 200,
    description: 'URL de OAuth generada',
    schema: {
      example: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Error al iniciar OAuth' })
  async googleSignIn(@Body() dto: OAuthInitiateDto) {
    return await this.oauthService.initiateGoogleSignIn(dto.redirectUrl);
  }

  @Post('apple')
  @ApiOperation({
    summary: 'Iniciar autenticación con Apple',
    description:
      'Retorna URL de OAuth de Apple. Frontend debe redirigir al usuario a esta URL.',
  })
  @ApiResponse({
    status: 200,
    description: 'URL de OAuth generada',
    schema: {
      example: {
        url: 'https://appleid.apple.com/auth/authorize?client_id=...',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Error al iniciar OAuth' })
  async appleSignIn(@Body() dto: OAuthInitiateDto) {
    return await this.oauthService.initiateAppleSignIn(dto.redirectUrl);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'Manejar callback de OAuth',
    description:
      'Procesa el callback de Google/Apple después de autenticación exitosa. ' +
      'Auto-crea usuario si es primera vez. Retorna accessToken y datos de usuario.',
  })
  @ApiQuery({
    name: 'access_token',
    required: true,
    description: 'Access token de Supabase',
  })
  @ApiQuery({
    name: 'refresh_token',
    required: false,
    description: 'Refresh token de Supabase',
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    description: 'Provider usado (google, apple)',
  })
  @ApiResponse({
    status: 200,
    description: 'Autenticación exitosa',
    schema: {
      example: {
        accessToken: 'eyJhbGc...',
        refreshToken: 'v1.abc...',
        user: {
          id: 'uuid-123',
          email: 'user@gmail.com',
          name: 'Juan',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'González',
          avatar: 'https://lh3.googleusercontent.com/...',
          google_connected: true,
          apple_connected: false,
        },
        needsPostRegistration: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Token de OAuth inválido',
  })
  async handleCallback(@Query() query: OAuthCallbackDto) {
    return await this.oauthService.handleCallback(query);
  }

  @Get('providers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener providers conectados',
    description:
      'Retorna los providers de OAuth (Google, Apple, Facebook) conectados al usuario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Providers conectados',
    schema: {
      example: {
        google_connected: true,
        apple_connected: false,
        fb_connected: false,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async getConnectedProviders(@Request() req) {
    return await this.oauthService.getConnectedProviders(req.user.user_id);
  }

  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Desconectar un provider',
    description:
      'Desconecta un provider de OAuth (google, apple, fb) del usuario. ' +
      'Nota: Esto solo actualiza el flag en BD, no desvincula la cuenta en Supabase.',
  })
  @ApiParam({
    name: 'provider',
    description: 'Provider a desconectar',
    enum: ['google', 'apple', 'fb'],
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
  @ApiResponse({ status: 400, description: 'Provider inválido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async disconnectProvider(
    @Param('provider') provider: string,
    @Request() req,
  ) {
    return await this.oauthService.disconnectProvider(
      req.user.user_id,
      provider,
    );
  }
}
