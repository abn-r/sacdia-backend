import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import PDFDocument from 'pdfkit';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
  type FileStorageService,
} from '../common/services/file-storage.service';
import type { QrMemberTokenDto } from './dto/qr-token.dto';
import type { ScanResponseDto } from './dto/scan-qr.dto';

const QR_MEMBER_AUDIENCE = 'sacdia:qr-member';
const QR_MEMBER_VERSION = 1;
const QR_MEMBER_TTL_SECONDS = 24 * 60 * 60;
const QR_PRIVATE_ASSET_TTL_SECONDS = 300;
const QR_CARD_TITLE = 'SACDIA';
const QR_CARD_SUBTITLE = 'Credencial virtual';

const ADMIN_SCOPE_ROLES = new Set(['admin', 'super_admin', 'coordinator']);

type QrMemberPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  ver: number;
};

type QrMemberView = {
  user_id: string;
  full_name: string;
  avatar: string | null;
  club_name: string | null;
  section_name: string | null;
};

type QrCardVisual = {
  title: string;
  subtitle: string;
  primary_line: string;
  secondary_line: string;
  club_name: string | null;
  section_name: string | null;
};

export type QrMeResponse = QrMemberTokenDto & {
  member: QrMemberView;
  authorization: ResolvedAuthorizationProfile['authorization'];
};

export type QrCardResponse = QrMemberTokenDto & {
  member: QrMemberView;
  visual: QrCardVisual;
};

export type QrValidationResponse = {
  valid: true;
  member: QrMemberView;
  attendance: ScanResponseDto['attendance'];
  scanned_at: string;
};

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
    private readonly authorizationContext: AuthorizationContextService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
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

  async getMyQr(userId: string): Promise<QrMeResponse> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const member = await this.resolveMemberView(resolved);

    return {
      ...this.generateMemberToken(userId),
      member,
      authorization: resolved.authorization,
    };
  }

  async getMyCard(userId: string): Promise<QrCardResponse> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const member = await this.resolveMemberView(resolved);

    return {
      ...this.generateMemberToken(userId),
      member,
      visual: this.buildCardVisual(resolved, member),
    };
  }

  async generateMyCardPdf(userId: string): Promise<Buffer> {
    const card = await this.getMyCard(userId);
    const doc = new PDFDocument({
      size: 'A6',
      layout: 'portrait',
      margins: { top: 24, bottom: 24, left: 24, right: 24 },
      info: {
        Title: `${QR_CARD_TITLE} - ${card.member.full_name}`,
        Author: 'SACDIA',
        Subject: QR_CARD_SUBTITLE,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const pdfReady = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawCardPdf(doc, card);
    doc.end();

    return pdfReady;
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
    const validation = await this.validateMemberQr(
      token,
      callerUserId,
      activityId,
    );

    return {
      member: validation.member,
      attendance: validation.attendance,
      scanned_at: validation.scanned_at,
    };
  }

  async validateMemberQr(
    token: string,
    callerUserId: string,
    activityId?: number,
  ): Promise<QrValidationResponse> {
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
      throw new AppNotFoundException(ErrorCode.QR_MEMBER_NOT_FOUND);
    }

    const signedAvatar = await this.resolveProfilePicture(user.user_image);

    const member = this.buildMemberView({
      user_id: user.user_id,
      name: user.name,
      paternal_last_name: user.paternal_last_name,
      maternal_last_name: user.maternal_last_name,
      user_image: signedAvatar,
      club_role_assignments: user.club_role_assignments,
      email: null,
    });

    let attendance: ScanResponseDto['attendance'] = null;
    if (activityId !== undefined) {
      attendance = await this.appendAttendance(
        activityId,
        payload.sub,
        callerUserId,
      );
    }

    return {
      valid: true,
      member,
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
      throw new AppUnauthorizedException(ErrorCode.QR_TOKEN_INVALID);
    }

    if (decoded.aud !== QR_MEMBER_AUDIENCE) {
      throw new AppUnauthorizedException(ErrorCode.QR_TOKEN_INVALID);
    }
    if (decoded.ver !== QR_MEMBER_VERSION) {
      throw new AppUnauthorizedException(ErrorCode.QR_TOKEN_INVALID);
    }
    if (!decoded.sub) {
      throw new AppUnauthorizedException(ErrorCode.QR_TOKEN_INVALID);
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
      throw new AppNotFoundException(ErrorCode.QR_ACTIVITY_NOT_FOUND);
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
        a.roles?.role_name != null && ADMIN_SCOPE_ROLES.has(a.roles.role_name),
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
      throw new AppForbiddenException(ErrorCode.QR_ACTIVITY_SCOPE_INVALID);
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
      throw new AppForbiddenException(ErrorCode.QR_ACCESS_DENIED);
    }
  }

  private async resolveMemberView(
    resolved: ResolvedAuthorizationProfile,
  ): Promise<QrMemberView> {
    const signedAvatar = await this.resolveProfilePicture(
      resolved.profile.user_image,
    );

    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;
    const activeAssignment = activeAssignmentId
      ? await this.prisma.club_role_assignments.findFirst({
          where: {
            assignment_id: activeAssignmentId,
            user_id: resolved.profile.user_id,
            active: true,
          },
          select: {
            club_sections: {
              select: {
                name: true,
                clubs: { select: { name: true } },
              },
            },
          },
        })
      : null;

    return this.buildMemberView({
      user_id: resolved.profile.user_id,
      name: resolved.profile.name,
      paternal_last_name: resolved.profile.paternal_last_name,
      maternal_last_name: resolved.profile.maternal_last_name,
      user_image: signedAvatar,
      email: resolved.profile.email,
      fallback_club_name: resolved.legacy.club?.club_name ?? null,
      fallback_section_name: resolved.legacy.club?.club_type ?? null,
      club_role_assignments: activeAssignment
        ? [
            {
              club_sections: activeAssignment.club_sections,
            },
          ]
        : [],
    });
  }

  private buildMemberView(input: {
    user_id: string;
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    user_image: string | null;
    club_role_assignments: Array<{
      club_sections?: {
        name: string | null;
        clubs?: { name: string | null } | null;
      } | null;
    }>;
    email: string | null;
    fallback_club_name?: string | null;
    fallback_section_name?: string | null;
  }): QrMemberView {
    const fullName = [
      input.name,
      input.paternal_last_name,
      input.maternal_last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const assignment = input.club_role_assignments[0];
    const sectionName = assignment?.club_sections?.name ?? null;
    const clubName = assignment?.club_sections?.clubs?.name ?? null;

    return {
      user_id: input.user_id,
      full_name: fullName || input.email || input.user_id,
      avatar: input.user_image ?? null,
      club_name: clubName ?? input.fallback_club_name ?? null,
      section_name: sectionName ?? input.fallback_section_name ?? null,
    };
  }

  private buildCardVisual(
    resolved: ResolvedAuthorizationProfile,
    member: QrMemberView,
  ): QrCardVisual {
    return {
      title: QR_CARD_TITLE,
      subtitle: QR_CARD_SUBTITLE,
      primary_line: member.full_name,
      secondary_line: resolved.profile.email,
      club_name: member.club_name,
      section_name: member.section_name,
    };
  }

  private async resolveProfilePicture(
    userImage: string | null | undefined,
  ): Promise<string | null> {
    if (!userImage) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        userImage,
        {
          expiresInSeconds: QR_PRIVATE_ASSET_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for QR profile picture. Returning null.',
        error,
      );
      return null;
    }
  }

  private drawCardPdf(
    doc: InstanceType<typeof PDFDocument>,
    card: QrCardResponse,
  ): void {
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(card.visual.title, { align: 'center' });

    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(card.visual.subtitle, { align: 'center' });

    doc.moveDown(1);
    doc.fontSize(13).font('Helvetica-Bold').text(card.member.full_name, {
      align: 'center',
    });
    doc.fontSize(9).font('Helvetica').text(card.member.user_id, {
      align: 'center',
    });

    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica-Bold').text('QR token:', {
      align: 'left',
    });
    doc
      .font('Courier')
      .fontSize(8)
      .text(card.token, { align: 'left', width: 210 });

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Club:', { continued: true });
    doc.font('Helvetica').text(` ${card.visual.club_name ?? 'N/A'}`);
    doc.font('Helvetica-Bold').text('Sección:', { continued: true });
    doc.font('Helvetica').text(` ${card.visual.section_name ?? 'N/A'}`);

    doc.moveDown(1);
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(
        'Fallback técnico: el PDF expone el token en texto porque el backend no ' +
          'incluye una librería de renderizado QR bitmap. El cliente puede dibujar ' +
          'el QR visual desde /qr/me/card.',
        { align: 'left' },
      );
  }
}
