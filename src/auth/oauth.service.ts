import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Inicia el flujo de autenticación con Google
   */
  async initiateGoogleSignIn(redirectUrl?: string) {
    const { data, error } = await this.supabase.admin.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl || 'https://sacdia.app/auth/callback',
      },
    });

    if (error) {
      this.logger.error(`Google OAuth initiation error: ${error.message}`);
      throw new InternalServerErrorException(
        'Error al iniciar OAuth con Google',
      );
    }

    return { url: data.url };
  }

  /**
   * Inicia el flujo de autenticación con Apple
   */
  async initiateAppleSignIn(redirectUrl?: string) {
    const { data, error } = await this.supabase.admin.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: redirectUrl || 'https://sacdia.app/auth/callback',
      },
    });

    if (error) {
      this.logger.error(`Apple OAuth initiation error: ${error.message}`);
      throw new InternalServerErrorException(
        'Error al iniciar OAuth con Apple',
      );
    }

    return { url: data.url };
  }

  /**
   * Maneja el callback de OAuth después de la autenticación exitosa
   * Auto-crea usuario si no existe
   */
  async handleCallback(dto: OAuthCallbackDto) {
    // 1. Obtener usuario de Supabase Auth
    const { data, error } = await this.supabase.admin.auth.getUser(
      dto.access_token,
    );

    if (error || !data.user) {
      this.logger.warn(`OAuth callback failed: ${error?.message}`);
      throw new UnauthorizedException('Invalid OAuth callback');
    }

    const supabaseUser = data.user;

    // 2. Verificar si usuario existe en BD
    let dbUser = await this.prisma.users.findUnique({
      where: { user_id: supabaseUser.id },
    });

    // 3. Si no existe, crear usuario automáticamente
    if (!dbUser) {
      this.logger.log(`Creating new user from OAuth: ${supabaseUser.email}`);
      dbUser = await this.createUserFromOAuth(supabaseUser);
    }

    // 4. Actualizar flags de providers conectados
    const identities = supabaseUser.identities || [];
    const googleConnected = identities.some((i) => i.provider === 'google');
    const appleConnected = identities.some((i) => i.provider === 'apple');

    await this.prisma.users.update({
      where: { user_id: supabaseUser.id },
      data: {
        google_connected: googleConnected,
        apple_connected: appleConnected,
      },
    });

    // 5. Verificar estado de post-registro
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: supabaseUser.id },
    });

    return {
      access_token: dto.access_token,
      refresh_token: dto.refresh_token,
      user: {
        id: dbUser.user_id,
        email: dbUser.email,
        name: dbUser.name,
        paternal_last_name: dbUser.paternal_last_name,
        maternal_last_name: dbUser.maternal_last_name,
        avatar: dbUser.user_image,
        google_connected: googleConnected,
        apple_connected: appleConnected,
      },
      needsPostRegistration: !userPr?.complete,
    };
  }

  /**
   * Crea un nuevo usuario en la BD a partir de datos de OAuth
   */
  private async createUserFromOAuth(supabaseUser: any) {
    return await this.prisma.$transaction(async (tx) => {
      // Crear usuario
      const user = await tx.users.create({
        data: {
          user_id: supabaseUser.id,
          email: supabaseUser.email,
          name:
            supabaseUser.user_metadata?.name ||
            supabaseUser.user_metadata?.full_name ||
            supabaseUser.email.split('@')[0],
          user_image:
            supabaseUser.user_metadata?.avatar_url ||
            supabaseUser.user_metadata?.picture,
        },
      });

      // Crear registro de post-registro
      await tx.users_pr.create({
        data: {
          user_id: user.user_id,
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
        },
      });

      // Asignar rol por defecto "user"
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

      this.logger.log(`User created successfully: ${user.user_id}`);

      return user;
    });
  }

  /**
   * Obtiene los providers conectados de un usuario
   */
  async getConnectedProviders(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        google_connected: true,
        apple_connected: true,
        fb_connected: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    return user;
  }

  /**
   * Desconecta un provider de un usuario
   * Nota: Esto solo actualiza el flag en BD, no desvincula en Supabase
   */
  async disconnectProvider(userId: string, provider: string) {
    const validProviders = ['google', 'apple', 'fb'];
    if (!validProviders.includes(provider)) {
      throw new BadRequestException(
        'Provider inválido. Usa: google, apple, o fb',
      );
    }

    const fieldName = `${provider}_connected`;

    await this.prisma.users.update({
      where: { user_id: userId },
      data: { [fieldName]: false },
    });

    this.logger.log(`Provider ${provider} disconnected for user: ${userId}`);

    return {
      success: true,
      message: 'Provider desconectado exitosamente',
    };
  }
}
