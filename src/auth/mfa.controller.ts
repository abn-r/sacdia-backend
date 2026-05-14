import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MfaGuard } from '../common/guards/mfa.guard';
import { SkipMfaCheck } from '../common/decorators/skip-mfa-check.decorator';
import { MfaService } from '../common/services/mfa.service';
import { EnrollMfaDto, VerifyMfaDto, DisableMfaDto } from './dto/mfa.dto';

/**
 * MfaController — Two-Factor Authentication endpoints.
 *
 * ## Authentication
 *
 * All endpoints are protected by JwtAuthGuard + MfaGuard.
 * The user's UUID (`userId`) is extracted from the SACDIA HS256 JWT payload
 * (`sub` field) — no separate session token is required.
 *
 * ## MFA enforcement
 *
 * POST /auth/mfa/verify is decorated with @SkipMfaCheck() so it is reachable
 * with an aal1 token (mfa_pending: true). All other endpoints require a full
 * aal2 token (mfa_pending absent or false). This prevents a user from
 * enrolling or disabling MFA without having first completed the second factor
 * in the current session.
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
@UseGuards(JwtAuthGuard, MfaGuard)
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
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — token requires aal2 (complete MFA verification first)',
  })
  async enrollMfa(@Req() req: Request, @Body() dto: EnrollMfaDto) {
    const userId = (req.user as any).userId as string;
    return this.mfaService.enrollMfa(userId, dto.password);
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  @Post('verify')
  // SkipMfaCheck: this is the endpoint that CLEARS mfa_pending.
  // It must be reachable with an aal1 token (mfa_pending: true).
  @SkipMfaCheck()
  // Strict rate limit: 5 attempts per minute — TOTP is 6-digit so brute force is feasible
  // without this guard. Allows for reasonable typos while blocking automated attacks.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: 'Verificar código TOTP',
    description:
      'Verifica un código de 6 dígitos de la app de autenticación. ' +
      'Si el código es válido, retorna un nuevo `accessToken` aal2 (sin mfa_pending) ' +
      'que el cliente debe usar en lugar del token original. ' +
      'Falla con 401 si TOTP no está enrolado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Resultado de la verificación',
    schema: {
      properties: {
        verified: { type: 'boolean', example: true },
        accessToken: {
          type: 'string',
          description:
            'Nuevo JWT aal2 emitido tras verificación exitosa. ' +
            'Reemplaza el token aal1 (mfa_pending) original. ' +
            'Ausente cuando verified es false.',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'TOTP no enrolado o código inválido',
  })
  async verifyMfa(@Req() req: Request, @Body() dto: VerifyMfaDto) {
    const userId = (req.user as any).userId as string;
    const email = (req.user as any).email as string;
    // Forward the `sid` claim from the aal1 token so the resulting aal2 JWT
    // preserves the BA session ID — required for is_current in GET /auth/sessions.
    const sessionId = (req.user as any).sid as string | null | undefined;
    return this.mfaService.verifyMfa(userId, email, dto.code, sessionId);
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
    description: 'Contraseña inválida, JWT expirado, o 2FA no enrolado',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — token requires aal2 (MFA already completed) to disable MFA',
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
  // Status check is safe to expose with an aal1 token — no sensitive action is taken.
  @SkipMfaCheck()
  @ApiOperation({
    summary: 'Estado de 2FA',
    description:
      'Indica si el usuario tiene 2FA habilitado. ' +
      'El campo `enabled` es true cuando hay un secreto TOTP enrolado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Estado MFA del usuario',
    schema: {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true si TOTP está enrolado para este usuario',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async getMfaStatus(@Req() req: Request) {
    const userId = (req.user as any).userId as string;
    return this.mfaService.getMfaStatus(userId);
  }
}
