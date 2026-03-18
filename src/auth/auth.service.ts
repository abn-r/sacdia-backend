import {
  Inject,
  Injectable,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
import { buildAuthTokenResponse } from './utils/auth-token-response.util';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

const LEGACY_SNAKE_CASE_REMOVED_AT = '2026-03-01';
const LEGACY_SNAKE_CASE_REMOVED_CODE = 'LEGACY_SNAKE_CASE_REMOVED';

type RefreshSessionContext = {
  userAgent?: string;
};

export type LogoutRequest = {
  accessToken?: string;
  refreshToken?: string;
  userAgent?: string;
};

type LogoutPath = 'access' | 'refresh' | 'none';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private readonly authorizationContext: AuthorizationContextService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async register(dto: RegisterDto) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Crear usuario en Supabase Auth
      const { data: authUser, error: authError } =
        await this.supabase.admin.auth.admin.createUser({
          email: dto.email,
          password: dto.password,
          email_confirm: true, // Auto-confirmar email
        });

      if (authError) {
        this.logger.error(
          `Supabase auth error: ${authError.message}`,
          authError,
        );
        throw new BadRequestException(authError.message);
      }

      try {
        // 2. Crear en tabla users
        const user = await tx.users.create({
          data: {
            user_id: authUser.user.id,
            email: dto.email,
            name: dto.name,
            paternal_last_name: dto.paternal_last_name,
            maternal_last_name: dto.maternal_last_name,
          },
        });

        // 3. Crear en users_pr con tracking granular
        await tx.users_pr.create({
          data: {
            user_id: user.user_id,
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        });

        // 4. Asignar rol "user" (GLOBAL)
        const userRole = await tx.roles.findFirst({
          where: {
            role_name: 'user',
            role_category: 'GLOBAL',
          },
        });

        if (!userRole) {
          throw new InternalServerErrorException('User role not found');
        }

        await tx.users_roles.create({
          data: {
            user_id: user.user_id,
            role_id: userRole.role_id,
          },
        });

        this.logger.log(`User registered successfully: ${user.user_id}`);

        return {
          success: true,
          userId: user.user_id,
          message: 'Usuario registrado exitosamente',
        };
      } catch (dbError) {
        // Rollback: Eliminar usuario de Supabase si falla BD
        this.logger.error(
          'Database error, rolling back Supabase user',
          dbError,
        );
        await this.supabase.admin.auth.admin.deleteUser(authUser.user.id);
        throw dbError;
      }
    });
  }

  async login(dto: LoginDto) {
    const maskedEmail = this.maskEmail(dto.email);

    // 1. Autenticar con Supabase
    const { data, error } = await this.supabase.admin.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      this.logger.warn(`Login failed for ${maskedEmail}: ${error.message}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!data?.user || !data.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_login_missing_session',
          email: maskedEmail,
        }),
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 2. Obtener información del usuario y verificar post-registro
    const user = await this.prisma.users.findUnique({
      where: { user_id: data.user.id },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        users_pr: {
          select: {
            complete: true,
            profile_picture_complete: true,
            personal_info_complete: true,
            club_selection_complete: true,
          },
        },
        users_roles: {
          where: { active: true },
          select: {
            roles: {
              select: {
                role_name: true,
                role_category: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const needsPostRegistration = user.users_pr[0]
      ? !user.users_pr[0].complete
      : true;

    // Extraer roles como array plano de strings
    const roles = (user.users_roles ?? []).map((ur) => ur.roles.role_name);

    return {
      status: 'success',
      data: {
        ...buildAuthTokenResponse({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at ?? null,
          tokenType: data.session.token_type ?? 'bearer',
        }),
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          paternal_last_name: user.paternal_last_name,
          maternal_last_name: user.maternal_last_name,
          avatar: await this.resolvePrivateProfilePicture(user.user_image),
          roles,
        },
        needsPostRegistration,
        postRegistrationStatus: user.users_pr[0] || null,
      },
    };
  }

  async refreshSession(
    dto: RefreshSessionDto,
    context?: RefreshSessionContext,
  ) {
    const rejectSnakeCase = this.shouldRejectSnakeCase();
    const usingLegacySnakeCase =
      !dto.refreshToken && Boolean(dto.refresh_token);
    const payloadFormat: 'camelCase' | 'snake_case' | 'none' = dto.refreshToken
      ? 'camelCase'
      : dto.refresh_token
        ? 'snake_case'
        : 'none';
    let refreshToken = dto.refreshToken;

    if (usingLegacySnakeCase) {
      if (rejectSnakeCase) {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_refresh_legacy_rejected',
            removedAt: LEGACY_SNAKE_CASE_REMOVED_AT,
            payloadFormat,
            userAgent: context?.userAgent ?? 'unknown',
          }),
        );

        throw new BadRequestException({
          message:
            'refresh_token was removed. Use refreshToken in request body.',
          code: LEGACY_SNAKE_CASE_REMOVED_CODE,
          removedAt: LEGACY_SNAKE_CASE_REMOVED_AT,
          use: 'refreshToken',
        });
      }

      refreshToken = dto.refresh_token;
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_legacy_allowed',
          compatibilityMode: true,
          payloadFormat,
          userAgent: context?.userAgent ?? 'unknown',
        }),
      );
    }

    if (!refreshToken) {
      throw new BadRequestException('refreshToken es requerido');
    }

    const { data, error } = await this.supabase.anon.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_failed',
          reason: error?.message ?? 'session is null',
          payloadFormat,
          userAgent: context?.userAgent ?? 'unknown',
        }),
      );
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    this.logger.log(
      JSON.stringify({
        event: 'auth_refresh_success',
        usedLegacyInput: usingLegacySnakeCase,
        payloadFormat,
      }),
    );

    return {
      status: 'success',
      data: buildAuthTokenResponse({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        tokenType: data.session.token_type ?? 'bearer',
      }),
    };
  }

  async logout(input: LogoutRequest = {}) {
    const accessToken = this.normalizeToken(input.accessToken);
    const refreshToken = this.normalizeToken(input.refreshToken);
    const userAgent = input.userAgent ?? 'unknown';

    let path: LogoutPath = 'none';
    let revocationAttempted = false;
    let revocationSucceeded = false;
    let reason: string | undefined;
    let tokenToRevoke = accessToken;

    if (tokenToRevoke) {
      path = 'access';
    } else if (refreshToken) {
      path = 'refresh';
      tokenToRevoke = await this.getAccessTokenForLogout(
        refreshToken,
        userAgent,
      );
      if (!tokenToRevoke) {
        reason = 'refresh_failed';
      }
    }

    if (tokenToRevoke) {
      revocationAttempted = true;
      const { error } =
        await this.supabase.admin.auth.admin.signOut(tokenToRevoke);
      if (error) {
        reason = error.message;
        this.logger.warn(
          JSON.stringify({
            event: 'auth_logout_revoke_failed',
            path,
            reason,
            userAgent,
          }),
        );
      } else {
        revocationSucceeded = true;
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'auth_logout_best_effort',
        path,
        revocationAttempted,
        revocationSucceeded,
        reason: reason ?? null,
        userAgent,
      }),
    );

    return {
      success: true,
      message: 'Sesión cerrada (best effort)',
      revocationAttempted,
      revocationSucceeded,
      path,
    };
  }

  async requestPasswordReset(dto: ResetPasswordRequestDto) {
    const { error } = await this.supabase.admin.auth.resetPasswordForEmail(
      dto.email,
      {
        redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
      },
    );

    if (error) {
      this.logger.error(
        `Password reset request error: ${error.message}`,
        error,
      );
      throw new BadRequestException('Error al solicitar recuperación');
    }

    this.logger.log(`Password reset requested for: ${dto.email}`);

    return {
      success: true,
      message: 'Correo de recuperación enviado',
    };
  }

  async getProfile(userId: string) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const signedUserImage = await this.resolvePrivateProfilePicture(
      resolved.profile.user_image,
    );

    return {
      status: 'success',
      data: {
        ...resolved.profile,
        user_image: signedUserImage,
        roles: resolved.legacy.roles,
        permissions: resolved.legacy.permissions,
        post_register_complete: resolved.post_register_complete,
        club: resolved.legacy.club,
        club_context: resolved.legacy.club_context,
        authorization: resolved.authorization,
      },
    };
  }

  async setActiveClubContext(userId: string, dto: SetActiveClubContextDto) {
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        assignment_id: dto.assignment_id,
        user_id: userId,
        active: true,
        status: 'active',
      },
      select: {
        assignment_id: true,
        roles: { select: { role_name: true } },
        club_sections: {
          select: {
            club_section_id: true,
            club_types: { select: { name: true } },
            clubs: { select: { club_id: true, name: true } },
          },
        },
      },
    });

    if (!assignment) {
      throw new BadRequestException(
        'La asignación no pertenece al usuario o no está activa',
      );
    }

    await this.prisma.users_pr.upsert({
      where: { user_id: userId },
      update: { active_club_assignment_id: dto.assignment_id },
      create: {
        user_id: userId,
        active_club_assignment_id: dto.assignment_id,
      },
    });

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    return {
      status: 'success',
      data: {
        active_assignment_id:
          resolved.authorization.active_assignment.assignment_id,
        club: resolved.legacy.club,
        active: resolved.legacy.club_context.active,
        authorization: resolved.authorization,
      },
    };
  }

  async getCompletionStatus(userId: string) {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
      select: {
        complete: true,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: true,
        date_completed: true,
      },
    });

    if (!userPr) {
      throw new BadRequestException('Post-registro no iniciado');
    }

    let nextStep: string | null = null;
    if (!userPr.profile_picture_complete) {
      nextStep = 'profilePicture';
    } else if (!userPr.personal_info_complete) {
      nextStep = 'personalInfo';
    } else if (!userPr.club_selection_complete) {
      nextStep = 'clubSelection';
    }

    return {
      status: 'success',
      data: {
        complete: userPr.complete,
        steps: {
          profilePicture: userPr.profile_picture_complete,
          personalInfo: userPr.personal_info_complete,
          clubSelection: userPr.club_selection_complete,
        },
        nextStep,
        dateCompleted: userPr.date_completed,
      },
    };
  }

  private async getAccessTokenForLogout(
    refreshToken: string,
    userAgent?: string,
  ): Promise<string | undefined> {
    try {
      const refreshed = await this.refreshSession(
        { refreshToken },
        { userAgent },
      );
      return this.normalizeToken(refreshed?.data?.accessToken);
    } catch {
      return undefined;
    }
  }

  private normalizeToken(token?: string | null): string | undefined {
    const normalized = token?.trim();
    return normalized ? normalized : undefined;
  }

  private async resolvePrivateProfilePicture(
    userImage: string | null | undefined,
  ): Promise<string | null> {
    if (!userImage) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        userImage,
        {
          expiresInSeconds: AuthService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for profile picture. Returning original value.',
        error,
      );
      return userImage;
    }
  }

  private shouldRejectSnakeCase(): boolean {
    return process.env.AUTH_REJECT_SNAKE_CASE?.toLowerCase() !== 'false';
  }

  private maskEmail(email?: string | null): string {
    if (!email) return 'unknown';

    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';

    const visibleLocal =
      localPart.length <= 2 ? (localPart[0] ?? '*') : localPart.slice(0, 2);
    return `${visibleLocal}***@${domain}`;
  }
}
