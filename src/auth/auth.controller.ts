import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { LogoutDto } from './dto/logout.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  // Strict rate limit: 5 attempts per minute on registration
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Registrar nuevo usuario' })
  @ApiResponse({
    status: 201,
    description: 'Usuario registrado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Error en validación o usuario ya existe',
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Strict rate limit: 5 attempts per minute on login (brute-force protection)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso, retorna tokens y usuario',
    schema: {
      example: {
        status: 'success',
        data: {
          accessToken: 'eyJhbGc...',
          refreshToken: 'v1.abc...',
          expiresAt: 1900000000,
          tokenType: 'bearer',
          user: {
            id: 'uuid-123',
            email: 'user@sacdia.app',
            name: 'Juan',
            paternal_last_name: 'Perez',
            maternal_last_name: 'Lopez',
            avatar: null,
            roles: ['user'],
          },
          needsPostRegistration: false,
          postRegistrationStatus: null,
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciales inválidas',
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refrescar sesión con refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Tokens renovados exitosamente',
    schema: {
      example: {
        status: 'success',
        data: {
          accessToken: 'eyJhbGc...',
          refreshToken: 'v1.abc...',
          expiresAt: 1900000000,
          tokenType: 'bearer',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Payload legacy no soportado (`refresh_token` retirado)',
    schema: {
      example: {
        statusCode: 400,
        message: 'refresh_token was removed. Use refreshToken in request body.',
        code: 'LEGACY_SNAKE_CASE_REMOVED',
        removedAt: '2026-03-01',
        use: 'refreshToken',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido o expirado',
  })
  async refresh(
    @Body() dto: RefreshSessionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refreshSession(dto, { userAgent });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar sesión' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
          example: 'v1.abc...',
          description:
            'Refresh token opcional para logout fail-safe cuando el access token ya expiró.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Sesión cerrada (best effort, no bloquea UX)',
  })
  async logout(
    @Headers('authorization') authorization?: string,
    @Body() dto: LogoutDto = {},
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.logout({
      accessToken: this.extractBearerToken(authorization),
      refreshToken: dto.refreshToken,
      userAgent,
    });
  }

  @Post('password/reset-request')
  @HttpCode(HttpStatus.OK)
  // Strict rate limit: 3 requests per minute to prevent email enumeration
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Solicitar recuperación de contraseña' })
  @ApiResponse({
    status: 200,
    description: 'Correo de recuperación enviado',
  })
  async requestPasswordReset(@Body() dto: ResetPasswordRequestDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('verify-email/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  // Rate limit: max 3 sends per minute to prevent token farming
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Enviar email de verificación al usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Email de verificación enviado (o ya verificado)',
    schema: {
      example: {
        success: true,
        message: 'Email de verificación enviado',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async sendVerificationEmail(@CurrentUser() user: { userId: string }) {
    return this.authService.sendVerificationEmail(user.userId);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('verify-email/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar verificación de email con token' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: 200,
    description: 'Email verificado exitosamente',
    schema: {
      example: {
        success: true,
        message: 'Email verificado exitosamente',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Token inválido, ya utilizado, o expirado',
  })
  async confirmEmailVerification(@Body() dto: VerifyEmailDto) {
    return this.authService.confirmEmailVerification(dto);
  }

  @Post('update-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update authenticated user password' })
  @ApiResponse({
    status: 200,
    description: 'Password updated',
  })
  async updatePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePasswordDto,
  ) {
    await this.authService.updatePassword(user.userId, dto.password);
    return { status: 'success', message: 'Password updated' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Información del usuario',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            user_id: { type: 'string', example: 'user-uuid' },
            email: { type: 'string', example: 'usuario@sacdia.app' },
            name: { type: 'string', example: 'Juan' },
            roles: {
              type: 'array',
              items: { type: 'string' },
              example: ['user'],
            },
            permissions: {
              type: 'array',
              items: { type: 'string' },
              example: ['read'],
            },
            authorization: {
              type: 'object',
              description:
                'Contrato canónico de autorización resuelto por backend.',
            },
            post_register_complete: {
              type: 'boolean',
              example: true,
              description: 'Indica si el usuario completó el post-registro.',
            },
          },
          required: [
            'user_id',
            'email',
            'roles',
            'permissions',
            'authorization',
            'post_register_complete',
          ],
        },
      },
      required: ['status', 'data'],
    },
  })
  async getProfile(@CurrentUser() user: { userId: string }) {
    return this.authService.getProfile(user.userId);
  }

  @Patch('me/context')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar contexto activo de club/instancia del usuario',
  })
  @ApiResponse({
    status: 200,
    description: 'Contexto activo actualizado',
  })
  @ApiResponse({
    status: 400,
    description: 'La asignación no pertenece o no está activa para el usuario',
  })
  async setActiveContext(
    @CurrentUser() user: { userId: string },
    @Body() dto: SetActiveClubContextDto,
  ) {
    return this.authService.setActiveClubContext(user.userId, dto);
  }

  @Get('profile/completion-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener estado del post-registro' })
  @ApiResponse({
    status: 200,
    description: 'Estado del post-registro del usuario',
  })
  async getCompletionStatus(@CurrentUser() user: { userId: string }) {
    return this.authService.getCompletionStatus(user.userId);
  }

  private extractBearerToken(authorization?: string): string | undefined {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return undefined;
    }

    return authorization.slice('Bearer '.length).trim();
  }
}
