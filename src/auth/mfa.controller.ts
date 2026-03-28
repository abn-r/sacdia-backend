import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MfaService } from '../common/services/mfa.service';
import { EnrollMfaDto, VerifyMfaDto, DisableMfaDto } from './dto/mfa.dto';

/**
 * MfaController — Two-Factor Authentication endpoints.
 *
 * ## Authentication
 *
 * All endpoints are protected by JwtAuthGuard.  The user's UUID (`userId`) is
 * extracted from the SACDIA HS256 JWT payload (`sub` field) — no separate
 * session token is required.
 *
 * ## Storage
 *
 * TOTP secrets are stored in the `verification` table with identifier
 * `totp:{userId}` and effectively never expire (expiresAt = 2099-01-01).
 *
 * ## One TOTP per user
 *
 * There is a single TOTP factor per user.  Re-enrolling overwrites the previous
 * secret and generates new backup codes.
 */
@ApiTags('auth')
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  // ---------------------------------------------------------------------------
  // Enroll
  // ---------------------------------------------------------------------------

  @Post('enroll')
  @ApiOperation({
    summary: 'Habilitar 2FA (TOTP)',
    description:
      'Activa la autenticación de dos factores para la cuenta. ' +
      'Retorna un `totpURI` desde el cual el cliente genera el QR code. ' +
      'También retorna `backupCodes` de un solo uso (mostrados una sola vez). ' +
      'Requiere la contraseña actual del usuario. ' +
      'Re-enrolar sobreescribe el secreto anterior.',
  })
  @ApiResponse({
    status: 201,
    description: 'TOTP URI y backup codes generados',
    schema: {
      properties: {
        totpURI: {
          type: 'string',
          example:
            'otpauth://totp/SACDIA:user@example.com?secret=BASE32SECRET&issuer=SACDIA',
          description: 'URI otpauth:// para generar el QR code en el cliente',
        },
        backupCodes: {
          type: 'array',
          items: { type: 'string', example: 'AB3XYZ12' },
          description:
            'Códigos de respaldo de un solo uso (10 códigos de 8 chars). ' +
            'Almacenados hasheados — estos son los únicos valores en claro.',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Contraseña inválida o JWT expirado',
  })
  async enrollMfa(@Req() req: Request, @Body() dto: EnrollMfaDto) {
    const userId = (req.user as any).userId as string;
    return this.mfaService.enrollMfa(userId, dto.password);
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  @Post('verify')
  @ApiOperation({
    summary: 'Verificar código TOTP',
    description:
      'Verifica un código de 6 dígitos de la app de autenticación. ' +
      'Retorna { verified: true } si el código es válido. ' +
      'Falla con 401 si TOTP no está enrolado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Resultado de la verificación',
    schema: {
      properties: {
        verified: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'TOTP no enrolado o código inválido',
  })
  async verifyMfa(@Req() req: Request, @Body() dto: VerifyMfaDto) {
    const userId = (req.user as any).userId as string;
    return this.mfaService.verifyMfa(userId, dto.code);
  }

  // ---------------------------------------------------------------------------
  // Disable
  // ---------------------------------------------------------------------------

  @Delete('disable')
  @ApiOperation({
    summary: 'Deshabilitar 2FA',
    description:
      'Desactiva la autenticación de dos factores para la cuenta. ' +
      'Elimina el secreto TOTP y los backup codes. ' +
      'Requiere la contraseña actual del usuario para confirmar la operación.',
  })
  @ApiResponse({
    status: 200,
    description: '2FA deshabilitado exitosamente',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '2FA disabled successfully' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Contraseña inválida o JWT expirado',
  })
  async disableMfa(@Req() req: Request, @Body() dto: DisableMfaDto) {
    const userId = (req.user as any).userId as string;
    await this.mfaService.disableMfa(userId, dto.password);
    return { success: true, message: '2FA disabled successfully' };
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  @Get('status')
  @ApiOperation({
    summary: 'Estado de 2FA',
    description:
      'Indica si el usuario tiene 2FA habilitado. ' +
      'El campo `enabled` es true cuando hay un secreto TOTP enrolado.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true si TOTP está enrolado para este usuario',
        },
      },
    },
  })
  async getMfaStatus(@Req() req: Request) {
    const userId = (req.user as any).userId as string;
    return this.mfaService.getMfaStatus(userId);
  }
}
