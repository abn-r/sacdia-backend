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
  async sendToUser(dto: SendNotificationDto, sentBy: string) {
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

    // Registrar log
    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'USER',
        target_type: 'user',
        target_id: dto.userId,
        sent_by: sentBy,
        tokens_sent: response.successCount,
        tokens_failed: response.failureCount,
      },
    });

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  }

  /**
   * Enviar notificación a todos los usuarios activos
   */
  async broadcast(dto: BroadcastNotificationDto, sentBy: string) {
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

    // Registrar log
    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'BROADCAST',
        target_type: 'all',
        target_id: null,
        sent_by: sentBy,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
    };
  }

  /**
   * Enviar notificación a miembros de una sección de club
   */
  async sendToClubMembers(
    clubSectionId: number,
    dto: Omit<BroadcastNotificationDto, 'userId'>,
    sentBy: string,
  ) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    // Obtener miembros de la sección del club
    const members = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
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

    // Registrar log
    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'CLUB',
        target_type: 'club_section',
        target_id: String(clubSectionId),
        sent_by: sentBy,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
      memberCount: userIds.length,
    };
  }

  /**
   * Obtener historial paginado de notificaciones enviadas
   */
  async getNotificationHistory(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.notification_logs.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.notification_logs.count(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
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
