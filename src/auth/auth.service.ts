import {
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
import { buildAuthTokenResponse } from './utils/auth-token-response.util';

const LEGACY_SNAKE_CASE_REMOVED_AT = '2026-03-01';
const LEGACY_SNAKE_CASE_REMOVED_CODE = 'LEGACY_SNAKE_CASE_REMOVED';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
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
    // 1. Autenticar con Supabase
    const { data, error } = await this.supabase.admin.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      this.logger.warn(`Login failed for ${dto.email}: ${error.message}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!data?.user || !data.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_login_missing_session',
          email: dto.email,
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
        }),
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          paternal_last_name: user.paternal_last_name,
          maternal_last_name: user.maternal_last_name,
          avatar: user.user_image,
          roles,
        },
        needsPostRegistration,
        postRegistrationStatus: user.users_pr[0] || null,
      },
    };
  }

  async refreshSession(dto: RefreshSessionDto) {
    const rejectSnakeCase = this.shouldRejectSnakeCase();
    const usingLegacySnakeCase = !dto.refreshToken && Boolean(dto.refresh_token);
    let refreshToken = dto.refreshToken;

    if (usingLegacySnakeCase) {
      if (rejectSnakeCase) {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_refresh_legacy_rejected',
            removedAt: LEGACY_SNAKE_CASE_REMOVED_AT,
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
        }),
      );
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    this.logger.log(
      JSON.stringify({
        event: 'auth_refresh_success',
        usedLegacyInput: usingLegacySnakeCase,
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

  async logout(accessToken: string) {
    const { error } = await this.supabase.admin.auth.admin.signOut(accessToken);

    if (error) {
      this.logger.error(`Logout error: ${error.message}`, error);
      throw new InternalServerErrorException('Error al cerrar sesión');
    }

    return { success: true, message: 'Sesión cerrada exitosamente' };
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
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        user_image: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        created_at: true,
        users_pr: {
          select: {
            complete: true,
          },
        },
        users_roles: {
          where: { active: true },
          select: {
            roles: {
              select: {
                role_name: true,
                role_category: true,
                role_permissions: {
                  where: { active: true },
                  select: {
                    permissions: {
                      select: {
                        permission_name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        club_role_assignments: {
          where: { active: true, status: 'active' },
          take: 1,
          orderBy: { start_date: 'desc' },
          select: {
            roles: { select: { role_name: true } },
            club_adventurers: {
              select: {
                club_adv_id: true,
                club_types: { select: { name: true } },
                clubs: { select: { club_id: true, name: true } },
              },
            },
            club_pathfinders: {
              select: {
                club_pathf_id: true,
                club_types: { select: { name: true } },
                clubs: { select: { club_id: true, name: true } },
              },
            },
            club_master_guild: {
              select: {
                club_mg_id: true,
                club_types: { select: { name: true } },
                clubs: { select: { club_id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    // Extraer roles como array plano de strings
    const roles = user.users_roles.map((ur) => ur.roles.role_name);

    // Extraer permisos únicos de todos los roles
    const permissionSet = new Set<string>();
    for (const ur of user.users_roles) {
      for (const rp of ur.roles.role_permissions) {
        permissionSet.add(rp.permissions.permission_name);
      }
    }

    const postRegisterComplete = user.users_pr?.[0]?.complete ?? false;

    // Extraer información del club desde la asignación activa
    const assignment = user.club_role_assignments?.[0];
    let clubInfo: { club_id: number; club_name: string; club_type: string } | null = null;
    if (assignment) {
      const instance =
        assignment.club_adventurers ??
        assignment.club_pathfinders ??
        assignment.club_master_guild;
      if (instance && instance.clubs) {
        clubInfo = {
          club_id: instance.clubs.club_id,
          club_name: instance.clubs.name,
          club_type: instance.club_types?.name ?? null,
        };
      }
    }

    const {
      users_roles: _ignored,
      club_role_assignments: _ignored2,
      users_pr: _ignored3,
      ...userData
    } = user;

    return {
      status: 'success',
      data: {
        ...userData,
        roles,
        permissions: Array.from(permissionSet),
        post_register_complete: postRegisterComplete,
        club: clubInfo,
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

  private shouldRejectSnakeCase(): boolean {
    return process.env.AUTH_REJECT_SNAKE_CASE?.toLowerCase() !== 'false';
  }
}
