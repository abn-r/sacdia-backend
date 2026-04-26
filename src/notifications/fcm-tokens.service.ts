import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppNotFoundException,
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const MAX_ACTIVE_TOKENS_PER_USER = 5;

export interface RegisterFcmTokenDto {
  token: string;
  device_type?: string;
  device_name?: string;
}

@Injectable()
export class FcmTokensService {
  private readonly logger = new Logger(FcmTokensService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Campos seguros a devolver — nunca incluir el campo `token`
   */
  private readonly safeSelect = {
    fcm_token_id: true,
    user_id: true,
    device_type: true,
    device_name: true,
    last_used: true,
    active: true,
    created_at: true,
  } as const;

  /**
   * Registrar o actualizar token FCM.
   * Caps active tokens per user at MAX_ACTIVE_TOKENS_PER_USER (5).
   * If the cap is exceeded after registration, the oldest tokens (by last_used ASC)
   * are deleted inside the same transaction.
   */
  async registerToken(userId: string, dto: RegisterFcmTokenDto) {
    return this.prisma.$transaction(async (tx) => {
      // Verificar si el token ya existe
      const existing = await tx.user_fcm_tokens.findFirst({
        where: { token: dto.token },
      });

      let result: any;

      if (existing) {
        // Si existe, re-activar token y asociarlo al usuario autenticado actual
        result = await tx.user_fcm_tokens.update({
          where: { fcm_token_id: existing.fcm_token_id },
          data: {
            user_id: userId,
            active: true,
            last_used: new Date(),
            device_type: dto.device_type,
            device_name: dto.device_name,
          },
          select: this.safeSelect,
        });
      } else {
        // Si no existe, crear nuevo
        result = await tx.user_fcm_tokens.create({
          data: {
            user_id: userId,
            token: dto.token,
            device_type: dto.device_type,
            device_name: dto.device_name,
            active: true,
          },
          select: this.safeSelect,
        });
      }

      // Cap: keep only the MAX_ACTIVE_TOKENS_PER_USER most recent active tokens.
      // Fetch top-N by last_used DESC, then delete any that fall outside that set.
      const topTokens = await tx.user_fcm_tokens.findMany({
        where: { user_id: userId, active: true },
        orderBy: { last_used: 'desc' },
        take: MAX_ACTIVE_TOKENS_PER_USER,
        select: { fcm_token_id: true },
      });

      const topIds = topTokens.map((t) => t.fcm_token_id);

      const pruned = await tx.user_fcm_tokens.deleteMany({
        where: {
          user_id: userId,
          active: true,
          fcm_token_id: { notIn: topIds },
        },
      });

      if (pruned.count > 0) {
        this.logger.debug(
          `FCM token cap enforced — pruned ${pruned.count} oldest active token(s) for user ${userId} (limit: ${MAX_ACTIVE_TOKENS_PER_USER})`,
        );
      }

      return result;
    });
  }

  /**
   * Desactivar token FCM por ID de registro (método seguro — no expone el token en la URL)
   */
  async unregisterTokenById(fcmTokenId: string, userId: string) {
    const existing = await this.prisma.user_fcm_tokens.findUnique({
      where: { fcm_token_id: fcmTokenId },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.FCM_TOKEN_NOT_FOUND);
    }

    if (existing.user_id !== userId) {
      throw new AppForbiddenException(ErrorCode.FCM_TOKEN_FORBIDDEN);
    }

    await this.prisma.user_fcm_tokens.update({
      where: { fcm_token_id: fcmTokenId },
      data: { active: false },
    });

    return {
      success: true,
      message: 'FCM token unregistered successfully',
    };
  }

  /**
   * Desactivar token FCM por valor de token (uso interno — no exponer en API)
   * @internal
   */
  async unregisterToken(token: string, userId: string) {
    const existing = await this.prisma.user_fcm_tokens.findFirst({
      where: { token },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.FCM_TOKEN_NOT_FOUND);
    }

    if (existing.user_id !== userId) {
      throw new AppForbiddenException(ErrorCode.FCM_TOKEN_FORBIDDEN);
    }

    await this.prisma.user_fcm_tokens.updateMany({
      where: { token, user_id: userId, active: true },
      data: { active: false },
    });

    return {
      success: true,
      message: 'FCM token unregistered successfully',
    };
  }

  /**
   * Obtener tokens activos de un usuario — sin exponer el valor del token
   */
  async getUserTokens(userId: string) {
    return this.prisma.user_fcm_tokens.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      select: this.safeSelect,
    });
  }

  /**
   * Actualizar `last_used` en bulk para los tokens entregados exitosamente.
   * Recibe los valores de token (strings FCM) en lugar de IDs para evitar
   * consultas adicionales en el path de envío.
   * @internal — llamado por el processor y el fallback síncrono post-delivery.
   */
  async updateLastUsed(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    await this.prisma.user_fcm_tokens.updateMany({
      where: { token: { in: tokens } },
      data: { last_used: new Date() },
    });
  }

  /**
   * Limpiar tokens viejos (no usados en 90 días).
   * Se ejecuta automáticamente todos los domingos a las 3 AM.
   */
  @Cron('0 3 * * 0', { name: 'fcm-tokens-cleanup' })
  async cleanupOldTokens(): Promise<void> {
    this.logger.log(
      'FCM token cleanup cron triggered — removing tokens unused for 90+ days...',
    );

    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const result = await this.prisma.user_fcm_tokens.deleteMany({
        where: {
          last_used: {
            lt: ninetyDaysAgo,
          },
        },
      });

      this.logger.log(
        `FCM token cleanup complete — deleted ${result.count} stale token(s)`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`FCM token cleanup failed: ${errorMessage}`);
    }
  }
}
