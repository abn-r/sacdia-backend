import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
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
  async refresh(@Body() dto: RefreshSessionDto) {
    return this.authService.refreshSession(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión' })
  @ApiResponse({
    status: 200,
    description: 'Sesión cerrada exitosamente',
  })
  async logout(@Headers('authorization') authorization: string) {
    const token = authorization?.replace('Bearer ', '');
    return this.authService.logout(token);
  }

  @Post('password/reset-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar recuperación de contraseña' })
  @ApiResponse({
    status: 200,
    description: 'Correo de recuperación enviado',
  })
  async requestPasswordReset(@Body() dto: ResetPasswordRequestDto) {
    return this.authService.requestPasswordReset(dto);
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
}
