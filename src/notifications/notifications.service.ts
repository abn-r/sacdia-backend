import { Injectable } from '@nestjs/common';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';

export interface SendNotificationDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface BroadcastNotificationDto {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  private isFcmConfigured(): boolean {
    return firebaseAdmin.apps.length > 0;
  }

  /**
   * Enviar notificación a un usuario específico
   */
  async sendToUser(dto: SendNotificationDto) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    // Obtener tokens FCM del usuario
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: {
        user_id: dto.userId,
        active: true,
      },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active FCM tokens found' };
    }

    const tokenStrings = tokens.map((t) => t.token);

    // Enviar notificación
    const response = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens: tokenStrings,
      notification: {
        title: dto.title,
        body: dto.body,
      },
      data: dto.data,
    });

    // Limpiar tokens inválidos
    if (response.failureCount > 0) {
      const failedTokens = response.responses
        .map((resp, idx) => (resp.success ? null : tokenStrings[idx]))
        .filter((token): token is string => token !== null);

      if (failedTokens.length > 0) {
        await this.prisma.user_fcm_tokens.updateMany({
          where: { token: { in: failedTokens } },
          data: { active: false },
        });
      }
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  }

  /**
   * Enviar notificación a todos los usuarios activos
   */
  async broadcast(dto: BroadcastNotificationDto) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active tokens' };
    }

    const tokenStrings = tokens.map((t) => t.token);

    // Firebase permite máximo 500 tokens por batch
    const batches = this.chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const response = await firebaseAdmin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: dto.title,
          body: dto.body,
        },
        data: dto.data,
      });

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;
    }

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
    };
  }

  /**
   * Enviar notificación a miembros de un club
   */
  async sendToClubMembers(
    clubInstanceId: number,
    instanceType: 'adventurers' | 'pathfinders' | 'master_guilds',
    dto: Omit<BroadcastNotificationDto, 'userId'>,
  ) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    // Mapear tipo de instancia a columna
    const columnMap = {
      adventurers: 'club_adv_id',
      pathfinders: 'club_pathf_id',
      master_guilds: 'club_mg_id',
    };

    // Obtener miembros del club
    const members = await this.prisma.club_role_assignments.findMany({
      where: {
        [columnMap[instanceType]]: clubInstanceId,
        active: true,
      },
      select: { user_id: true },
    });

    const userIds = members.map((m) => m.user_id);

    if (userIds.length === 0) {
      return { success: false, message: 'No members found' };
    }

    // Obtener tokens de esos usuarios
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: {
        user_id: { in: userIds },
        active: true,
      },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active tokens for club members' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = this.chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const response = await firebaseAdmin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: dto.title,
          body: dto.body,
        },
        data: dto.data,
      });

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;
    }

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
      memberCount: userIds.length,
    };
  }

  /**
   * Utility: Dividir array en chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
