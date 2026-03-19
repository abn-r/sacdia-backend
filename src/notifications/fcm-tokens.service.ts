import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RegisterFcmTokenDto {
  token: string;
  device_type?: string;
  device_name?: string;
}

@Injectable()
export class FcmTokensService {
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
   * Registrar o actualizar token FCM
   */
  async registerToken(userId: string, dto: RegisterFcmTokenDto) {
    // Verificar si el token ya existe
    const existing = await this.prisma.user_fcm_tokens.findFirst({
      where: { token: dto.token },
    });

    if (existing) {
      // Si existe, re-activar token y asociarlo al usuario autenticado actual
      return this.prisma.user_fcm_tokens.update({
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
    }

    // Si no existe, crear nuevo
    return this.prisma.user_fcm_tokens.create({
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

  /**
   * Desactivar token FCM por ID de registro (método seguro — no expone el token en la URL)
   */
  async unregisterTokenById(fcmTokenId: string, userId: string) {
    const existing = await this.prisma.user_fcm_tokens.findUnique({
      where: { fcm_token_id: fcmTokenId },
    });

    if (!existing) {
      throw new NotFoundException('FCM token not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only unregister your own tokens');
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
      throw new NotFoundException('FCM token not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only unregister your own tokens');
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
   * Limpiar tokens viejos (no usados en 90 días)
   */
  async cleanupOldTokens() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await this.prisma.user_fcm_tokens.deleteMany({
      where: {
        last_used: {
          lt: ninetyDaysAgo,
        },
      },
    });

    return { deletedCount: result.count };
  }
}
