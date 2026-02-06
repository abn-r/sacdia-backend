import { Injectable } from '@nestjs/common';
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
   * Registrar o actualizar token FCM
   */
  async registerToken(userId: string, dto: RegisterFcmTokenDto) {
    // Verificar si el token ya existe
    const existing = await this.prisma.user_fcm_tokens.findFirst({
      where: { token: dto.token },
    });

    if (existing) {
      // Si existe, actualizar last_used y activarlo
      return this.prisma.user_fcm_tokens.update({
        where: { fcm_token_id: existing.fcm_token_id },
        data: {
          active: true,
          last_used: new Date(),
          device_type: dto.device_type,
          device_name: dto.device_name,
        },
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
    });
  }

  /**
   * Desactivar token FCM (logout o desinstalación)
   */
  async unregisterToken(token: string) {
    return this.prisma.user_fcm_tokens.updateMany({
      where: { token },
      data: { active: false },
    });
  }

  /**
   * Obtener tokens activos de un usuario
   */
  async getUserTokens(userId: string) {
    return this.prisma.user_fcm_tokens.findMany({
      where: {
        user_id: userId,
        active: true,
      },
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
