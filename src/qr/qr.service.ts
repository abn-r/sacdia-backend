import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import type { QrMemberTokenDto } from './dto/qr-token.dto';
import type { ScanResponseDto } from './dto/scan-qr.dto';

const QR_MEMBER_AUDIENCE = 'sacdia:qr-member';
const QR_MEMBER_VERSION = 1;
const QR_MEMBER_TTL_SECONDS = 24 * 60 * 60;

type QrMemberPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  ver: number;
};

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
  ) {}

  generateMemberToken(userId: string): QrMemberTokenDto {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + QR_MEMBER_TTL_SECONDS;

    const token = this.jwtService.sign(
      {
        sub: userId,
        aud: QR_MEMBER_AUDIENCE,
        iat,
        exp,
        ver: QR_MEMBER_VERSION,
      },
      {
        algorithm: 'HS256',
      },
    );

    return {
      token,
      expires_at: new Date(exp * 1000).toISOString(),
      expires_in: QR_MEMBER_TTL_SECONDS,
    };
  }

  /**
   * Validates a scanned QR token and optionally registers attendance on an
   * activity. Signature, audience, version and expiry are enforced before
   * any DB write.
   */
  async scanMemberToken(
    token: string,
    activityId?: number,
  ): Promise<ScanResponseDto> {
    const payload = this.verifyMemberToken(token);

    const user = await this.prisma.users.findUnique({
      where: { user_id: payload.sub },
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        club_role_assignments: {
          where: { active: true },
          orderBy: { start_date: 'desc' },
          select: {
            club_sections: {
              select: {
                name: true,
                clubs: { select: { name: true } },
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('El miembro del QR no existe');
    }

    const fullName = [
      user.name,
      user.paternal_last_name,
      user.maternal_last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const assignment = user.club_role_assignments[0];
    const sectionName = assignment?.club_sections?.name ?? null;
    const clubName = assignment?.club_sections?.clubs?.name ?? null;

    let attendance: ScanResponseDto['attendance'] = null;
    if (activityId !== undefined) {
      attendance = await this.appendAttendance(activityId, payload.sub);
    }

    return {
      member: {
        user_id: user.user_id,
        full_name: fullName || user.user_id,
        avatar: user.user_image ?? null,
        club_name: clubName,
        section_name: sectionName,
      },
      attendance,
      scanned_at: new Date().toISOString(),
    };
  }

  private verifyMemberToken(token: string): QrMemberPayload {
    let decoded: QrMemberPayload;
    try {
      decoded = this.jwtService.verify<QrMemberPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch (error) {
      this.logger.debug(`QR token verify failed: ${(error as Error).message}`);
      throw new UnauthorizedException('QR invalido o expirado');
    }

    if (decoded.aud !== QR_MEMBER_AUDIENCE) {
      throw new UnauthorizedException('QR con audiencia invalida');
    }
    if (decoded.ver !== QR_MEMBER_VERSION) {
      throw new UnauthorizedException('QR con version no soportada');
    }
    if (!decoded.sub) {
      throw new UnauthorizedException('QR sin sujeto');
    }
    return decoded;
  }

  private async appendAttendance(
    activityId: number,
    userId: string,
  ): Promise<ScanResponseDto['attendance']> {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        activity_id: true,
        attendees: true,
        activity_type_id: true,
        activity_types: { select: { code: true } },
        club_sections: { select: { main_club_id: true } },
      },
    });

    if (!activity) {
      throw new NotFoundException(`Activity ${activityId} no encontrada`);
    }

    const current = Array.isArray(activity.attendees)
      ? (activity.attendees as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];

    if (current.includes(userId)) {
      return {
        registered: false,
        already_present: true,
        activity_id: activityId,
      };
    }

    const next = [...current, userId];
    await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        attendees: next as Prisma.InputJsonValue,
        modified_at: new Date(),
      },
    });

    try {
      await this.achievementsService.emitEvent({
        userId,
        eventType: 'activity.attended',
        payload: {
          activity_id: activityId,
          activity_type:
            activity.activity_types?.code ?? activity.activity_type_id,
          club_id: activity.club_sections?.main_club_id ?? null,
          source: 'qr-scan',
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event for QR scan: ${(error as Error).message}`,
      );
    }

    return {
      registered: true,
      already_present: false,
      activity_id: activityId,
    };
  }

}
