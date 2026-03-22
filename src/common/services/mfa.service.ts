import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const MFA_SESSION_BIND_FAILED = 'MFA_SESSION_BIND_FAILED';

export interface MfaEnrollResponse {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export interface MfaFactor {
  id: string;
  friendlyName: string;
  factorType: string;
  status: string;
  createdAt: string;
}

/**
 * Servicio para manejar Autenticación de Dos Factores (2FA) con Supabase MFA.
 * Soporta TOTP (Time-based One-Time Password).
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    );
  }

  /**
   * Iniciar el proceso de enrolamiento de 2FA para un usuario.
   * Genera un QR code y secret para configurar en app de autenticación.
   */
  async enrollMfa(
    accessToken: string,
    refreshToken?: string,
  ): Promise<MfaEnrollResponse> {
    try {
      // Establecer sesión del usuario
      await this.bindSession(accessToken, refreshToken);

      // Enrolar nuevo factor TOTP
      const { data, error } = await this.supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'SACDIA Authenticator',
      });

      if (error) {
        this.logger.error(`MFA enrollment failed: ${error.message}`);
        throw new BadRequestException(error.message);
      }

      this.logger.log(`MFA enrollment initiated for user`);

      return {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`MFA enrollment error: ${error}`);
      throw new BadRequestException('Failed to enroll MFA');
    }
  }

  /**
   * Verificar el código TOTP y activar 2FA.
   * El usuario debe proporcionar un código válido de su app de autenticación.
   */
  async verifyAndActivateMfa(
    accessToken: string,
    factorId: string,
    code: string,
    refreshToken?: string,
  ): Promise<{ verified: boolean }> {
    try {
      // Establecer sesión
      await this.bindSession(accessToken, refreshToken);

      // Crear challenge
      const { data: challengeData, error: challengeError } =
        await this.supabase.auth.mfa.challenge({ factorId });

      if (challengeError) {
        throw new BadRequestException(challengeError.message);
      }

      // Verificar el código
      const { data, error } = await this.supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

      if (error) {
        this.logger.warn(`MFA verification failed: ${error.message}`);
        throw new UnauthorizedException('Invalid MFA code');
      }

      this.logger.log(`MFA verified and activated`);

      return { verified: true };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new BadRequestException('MFA verification failed');
    }
  }

  /**
   * Verificar código MFA durante el login.
   */
  async verifyMfaCode(
    accessToken: string,
    factorId: string,
    code: string,
    refreshToken?: string,
  ): Promise<boolean> {
    try {
      await this.bindSession(accessToken, refreshToken);

      const { data: challengeData, error: challengeError } =
        await this.supabase.auth.mfa.challenge({ factorId });

      if (challengeError) {
        return false;
      }

      const { error } = await this.supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Obtener los factores MFA configurados para un usuario.
   */
  async listFactors(
    accessToken: string,
    refreshToken?: string,
  ): Promise<MfaFactor[]> {
    try {
      await this.bindSession(accessToken, refreshToken);

      const { data, error } = await this.supabase.auth.mfa.listFactors();

      if (error) {
        throw new BadRequestException(error.message);
      }

      return (data.totp || []).map((factor) => ({
        id: factor.id,
        friendlyName: factor.friendly_name || 'Authenticator',
        factorType: factor.factor_type,
        status: factor.status,
        createdAt: factor.created_at,
      }));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to list MFA factors');
    }
  }

  /**
   * Eliminar un factor MFA (deshabilitar 2FA).
   */
  async unenrollFactor(
    accessToken: string,
    factorId: string,
    refreshToken?: string,
  ): Promise<void> {
    try {
      await this.bindSession(accessToken, refreshToken);

      const { error } = await this.supabase.auth.mfa.unenroll({ factorId });

      if (error) {
        throw new BadRequestException(error.message);
      }

      this.logger.log(`MFA factor ${factorId} unenrolled`);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to unenroll MFA factor');
    }
  }

  /**
   * Verificar si el usuario tiene MFA habilitado.
   */
  async hasMfaEnabled(
    accessToken: string,
    refreshToken?: string,
  ): Promise<boolean> {
    const factors = await this.listFactors(accessToken, refreshToken);
    return factors.some((f) => f.status === 'verified');
  }

  /**
   * Obtener el nivel de autenticación actual.
   * aal1 = solo password, aal2 = password + MFA
   */
  async getAuthenticatorAssuranceLevel(
    accessToken: string,
    refreshToken?: string,
  ): Promise<{ currentLevel: string; nextLevel: string | null }> {
    try {
      await this.bindSession(accessToken, refreshToken);

      const { data, error } =
        await this.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (error) {
        throw new BadRequestException(error.message);
      }

      return {
        currentLevel: data.currentLevel || 'aal1',
        nextLevel: data.nextLevel,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return { currentLevel: 'aal1', nextLevel: null };
    }
  }

  private async bindSession(
    accessToken: string,
    refreshToken?: string,
  ): Promise<void> {
    if (!accessToken?.trim()) {
      throw new BadRequestException({
        code: MFA_SESSION_BIND_FAILED,
        message: 'No access token found for MFA operation.',
      });
    }

    const normalizedRefreshToken = refreshToken?.trim() ?? '';
    const { error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: normalizedRefreshToken,
    });

    if (!error) return;

    if (!normalizedRefreshToken) {
      this.logger.warn(
        JSON.stringify({
          event: 'mfa_session_bind_failed',
          reason: 'missing_refresh_token',
          detail: error.message,
        }),
      );

      throw new BadRequestException({
        code: MFA_SESSION_BIND_FAILED,
        message:
          'No se pudo ligar la sesión MFA. Proporcione x-refresh-token y reintente.',
        use: 'x-refresh-token',
      });
    }

    throw new BadRequestException('Invalid session');
  }
}
