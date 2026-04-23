import {
  ForbiddenException,
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

const ADMIN_SCOPE_ROLES = new Set(['admin', 'super_admin', 'coordinator']);

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
    const now = Math.floor(Date.now() / 1000);
    const exp = now + QR_MEMBER_TTL_SECONDS;

    // Do NOT include `iat` or `exp` in the payload — JwtModule already sets
    // expiresIn via signOptions. Passing exp here would cause jsonwebtoken to
    // throw "Bad options.expiresIn: payload already has an exp property".
    const token = this.jwtService.sign({
      sub: userId,
      aud: QR_MEMBER_AUDIENCE,
      ver: QR_MEMBER_VERSION,
    });

    return {
      token,
      expires_at: new Date(exp * 1000).toISOString(),
      expires_in: QR_MEMBER_TTL_SECONDS,
    };
  }

  /**
   * Validates a scanned QR token and optionally registers attendance on an
   * activity. Signature, audience, version and expiry are enforced before
   * any DB write. When `activityId` is supplied, the caller must also be
   * assigned to the activity's section (or an admin/coordinator) — this
   * replicates the activity-scope check done by the regular attendance
   * endpoint via `@AuthorizationResource`.
   */
  async scanMemberToken(
    token: string,
    callerUserId: string,
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
      attendance = await this.appendAttendance(
        activityId,
        payload.sub,
        callerUserId,
      );
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
    memberUserId: string,
    callerUserId: string,
  ): Promise<ScanResponseDto['attendance']> {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        activity_id: true,
        attendees: true,
        activity_type_id: true,
        is_joint: true,
        club_section_id: true,
        activity_types: { select: { code: true } },
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
          },
        },
        activity_instances: {
          where: { active: true },
          select: { club_section_id: true },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException(`Activity ${activityId} no encontrada`);
    }

    await this.assertCallerCanManageActivity(callerUserId, activity);

    const current = Array.isArray(activity.attendees)
      ? (activity.attendees as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];

    if (current.includes(memberUserId)) {
      return {
        registered: false,
        already_present: true,
        activity_id: activityId,
      };
    }

    const next = [...current, memberUserId];
    await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        attendees: next as Prisma.InputJsonValue,
        modified_at: new Date(),
      },
    });

    try {
      await this.achievementsService.emitEvent({
        userId: memberUserId,
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

  /**
   * Enforces the same activity-scope rule as `@AuthorizationResource(activity)`
   * used by `/activities/:id/attendance`: the caller must either (a) hold a
   * global role that owns every activity (`admin`/`super_admin`/`coordinator`)
   * or (b) have an active assignment in the activity's section (or any of the
   * participating sections, for joint activities).
   */
  private async assertCallerCanManageActivity(
    callerUserId: string,
    activity: {
      is_joint: boolean;
      club_section_id: number | null;
      club_sections: { club_section_id: number } | null;
      activity_instances: { club_section_id: number | null }[];
    },
  ): Promise<void> {
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: { user_id: callerUserId, active: true },
      select: {
        club_section_id: true,
        roles: { select: { role_name: true } },
      },
    });

    const hasAdminRole = assignments.some(
      (a) =>
        a.roles?.role_name != null &&
        ADMIN_SCOPE_ROLES.has(a.roles.role_name),
    );
    if (hasAdminRole) return;

    const allowedSections = new Set<number>();
    if (activity.is_joint) {
      for (const inst of activity.activity_instances) {
        if (inst.club_section_id != null) {
          allowedSections.add(inst.club_section_id);
        }
      }
    } else {
      const sectionId =
        activity.club_sections?.club_section_id ?? activity.club_section_id;
      if (sectionId != null) allowedSections.add(sectionId);
    }

    if (allowedSections.size === 0) {
      throw new ForbiddenException(
        'Actividad sin seccion asignada — no se puede verificar alcance',
      );
    }

    const callerSections = new Set(
      assignments
        .map((a) => a.club_section_id)
        .filter((id): id is number => id != null),
    );

    const intersects = [...callerSections].some((id) =>
      allowedSections.has(id),
    );
    if (!intersects) {
      throw new ForbiddenException(
        'No tienes acceso a esta actividad',
      );
    }
  }
}
