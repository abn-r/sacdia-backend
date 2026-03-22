import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MfaService } from '../common/services/mfa.service';
import { EnrollMfaDto, VerifyMfaDto, DisableMfaDto } from './dto/mfa.dto';

/**
 * MfaController — Two-Factor Authentication endpoints.
 *
 * ## Session token vs. JWT
 *
 * The `Authorization: Bearer <jwt>` header carries the SACDIA HS256 JWT used
 * by JwtAuthGuard for route protection.  That JWT does NOT contain the opaque
 * Better Auth session token needed for MFA operations.
 *
 * Clients MUST also send the opaque BA session token via `x-session-token`.
 * This is the value returned by the sign-in/sign-up response in
 * `session.token`.  Without it, all MFA operations will fail with 401.
 *
 * ## Why a separate header?
 * Better Auth's twoFactor plugin requires a live session cookie to authorize
 * enroll/verify/disable.  The SACDIA JWT is a short-lived (1h) wrapper token
 * — it does not grant access to BA's internal session middleware.
 */
@ApiTags('auth')
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiHeader({
  name: 'x-session-token',
  required: true,
  description:
    'Opaque Better Auth session token (returned in session.token after sign-in). ' +
    'Required for all MFA operations.',
})
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
      'También retorna `backupCodes` de un solo uso. ' +
      'Requiere la contraseña actual del usuario.',
  })
  @ApiResponse({
    status: 201,
    description: 'TOTP URI y backup codes generados',
    schema: {
      properties: {
        totpURI: {
          type: 'string',
          description: 'URI otpauth:// para generar el QR code en el cliente',
        },
        backupCodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Códigos de respaldo de un solo uso',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Contraseña inválida o sesión expirada' })
  async enrollMfa(
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: EnrollMfaDto,
  ) {
    this.requireSessionToken(sessionToken);
    return this.mfaService.enrollMfa(sessionToken, dto.password);
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  @Post('verify')
  @ApiOperation({
    summary: 'Verificar código TOTP',
    description:
      'Verifica un código de 6 dígitos de la app de autenticación. ' +
      'Úsalo para activar 2FA después del enrolamiento o para elevar ' +
      'la sesión de aal1 a aal2 durante el login.',
  })
  @ApiResponse({
    status: 201,
    description: 'Código verificado exitosamente',
    schema: {
      properties: {
        verified: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Código TOTP inválido' })
  async verifyMfa(
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: VerifyMfaDto,
  ) {
    this.requireSessionToken(sessionToken);
    return this.mfaService.verifyMfa(sessionToken, dto.code);
  }

  // ---------------------------------------------------------------------------
  // Disable / unenroll
  // ---------------------------------------------------------------------------

  @Delete('unenroll')
  @ApiOperation({
    summary: 'Deshabilitar 2FA',
    description:
      'Desactiva la autenticación de dos factores para la cuenta. ' +
      'Requiere la contraseña actual del usuario para confirmar la operación.',
  })
  @ApiResponse({ status: 200, description: '2FA deshabilitado exitosamente' })
  @ApiResponse({ status: 401, description: 'Contraseña inválida o sesión expirada' })
  async disableMfa(
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: DisableMfaDto,
  ) {
    this.requireSessionToken(sessionToken);
    await this.mfaService.disableMfa(sessionToken, dto.password);
    return { success: true, message: '2FA disabled successfully' };
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  @Get('status')
  @ApiOperation({
    summary: 'Estado de 2FA y nivel de autenticación',
    description:
      'Indica si el usuario tiene 2FA habilitado (enabled) y el nivel de ' +
      'autenticación actual de la sesión (aal1 = solo password, aal2 = password + TOTP verificado).',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        enabled: { type: 'boolean', description: 'true si 2FA está habilitado' },
        currentLevel: {
          type: 'string',
          enum: ['aal1', 'aal2'],
          description: 'aal1 = solo password, aal2 = password + MFA verificado',
        },
        nextLevel: {
          type: 'string',
          nullable: true,
          description: 'aal2 si hay TOTP enrollado pero no verificado en esta sesión',
        },
      },
    },
  })
  async getMfaStatus(@Headers('x-session-token') sessionToken: string) {
    this.requireSessionToken(sessionToken);
    const [status, aal] = await Promise.all([
      this.mfaService.getMfaStatus(sessionToken),
      this.mfaService.getAssuranceLevel(sessionToken),
    ]);

    return {
      enabled: status.enabled,
      currentLevel: aal.currentLevel,
      nextLevel: aal.nextLevel,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Guards against missing session token before calling MfaService.
   * JwtAuthGuard already validates the JWT — this validates the BA session token.
   */
  private requireSessionToken(sessionToken: string | undefined): void {
    if (!sessionToken?.trim()) {
      throw new UnauthorizedException(
        'Missing x-session-token header. Provide the opaque BA session token ' +
          'returned in session.token after sign-in.',
      );
    }
  }
}
