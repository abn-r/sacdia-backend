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
import QRCode from 'qrcode';
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

const ADMIN_SCOPE_ROLES = new Set(['admin', 'super-admin', 'coordinator']);

type QrMemberPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  ver: number;
};

type QrEmergencyContact = {
  name: string;
  phone: string;
  relationship: string;
};

type QrMemberView = {
  user_id: string;
  full_name: string;
  avatar: string | null;
  club_name: string | null;
  section_name: string | null;
  current_class?: string | null;
  blood_type?: string | null;
  emergency_contact?: QrEmergencyContact | null;
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

    const [member, cardExtras] = await Promise.all([
      this.resolveMemberView(resolved),
      this.resolveCardExtras(userId),
    ]);

    const enrichedMember: QrMemberView = {
      ...member,
      ...cardExtras,
    };

    return {
      ...this.generateMemberToken(userId),
      member: enrichedMember,
      visual: this.buildCardVisual(resolved, enrichedMember),
    };
  }

  async generateMyCardPdf(userId: string): Promise<Buffer> {
    const card = await this.getMyCard(userId);

    // Fetch avatar bytes from the signed R2 URL (best-effort — never blocks PDF)
    let avatarBuffer: Buffer | null = null;
    if (card.member.avatar) {
      avatarBuffer = await this.fetchAvatarBuffer(card.member.avatar);
    }

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

    await this.drawCardPdf(doc, card, avatarBuffer);
    doc.end();

    return pdfReady;
  }

  /**
   * Fetches avatar image bytes from the given signed URL.
   * Returns null on any failure — timeout, bad content-type, oversized payload,
   * or network error — so the PDF renders the initials fallback instead.
   */
  private async fetchAvatarBuffer(url: string): Promise<Buffer | null> {
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(
          `fetchAvatarBuffer: HTTP ${response.status} for avatar URL — skipping`,
        );
        return null;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        this.logger.warn(
          `fetchAvatarBuffer: unexpected content-type "${contentType}" — skipping`,
        );
        return null;
      }

      // webp is not supported by pdfkit natively — skip it
      if (contentType.includes('webp')) {
        this.logger.warn(
          'fetchAvatarBuffer: webp avatar not supported by pdfkit — skipping',
        );
        return null;
      }

      // Guard against oversized payloads using Content-Length header
      const contentLength = parseInt(
        response.headers.get('content-length') ?? '0',
        10,
      );
      if (contentLength > MAX_BYTES) {
        this.logger.warn(
          `fetchAvatarBuffer: Content-Length ${contentLength} exceeds 5 MB cap — skipping`,
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);

      // Secondary size check after reading (Content-Length may be absent)
      if (buf.length > MAX_BYTES) {
        this.logger.warn(
          `fetchAvatarBuffer: actual buffer ${buf.length} bytes exceeds 5 MB cap — skipping`,
        );
        return null;
      }

      return buf;
    } catch (error) {
      this.logger.warn(
        `fetchAvatarBuffer: failed to fetch avatar — ${(error as Error).message}`,
      );
      return null;
    }
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
   * global role that owns every activity (`admin`/`super-admin`/`coordinator`)
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

  /**
   * Fetches the three extra fields used exclusively by the credential card:
   * current_class, blood_type, and emergency_contact.
   * Single query — no N+1.
   */
  private async resolveCardExtras(userId: string): Promise<{
    current_class: string | null;
    blood_type: string | null;
    emergency_contact: QrEmergencyContact | null;
  }> {
    const [userRow, latestEnrollment, primaryContact] = await Promise.all([
      this.prisma.users.findUnique({
        where: { user_id: userId },
        select: { blood: true },
      }),
      this.prisma.enrollments.findFirst({
        where: { user_id: userId, active: true },
        orderBy: { enrollment_date: 'desc' },
        select: {
          classes: { select: { name: true } },
        },
      }),
      this.prisma.emergency_contacts.findFirst({
        where: {
          owner_id: userId,
          active: true,
        },
        orderBy: [
          // primary contacts first, then most recently created
          { primary: 'desc' },
          { created_at: 'desc' },
        ],
        select: {
          name: true,
          phone: true,
          relationship_types: { select: { name: true } },
        },
      }),
    ]);

    const bloodType = userRow?.blood ?? null;
    if (bloodType === null && !userRow) {
      this.logger.warn(
        `resolveCardExtras: user ${userId} not found — blood_type will be null`,
      );
    }

    const currentClass = latestEnrollment?.classes?.name ?? null;

    const emergencyContact = primaryContact
      ? {
          name: primaryContact.name,
          phone: primaryContact.phone,
          relationship: primaryContact.relationship_types.name,
        }
      : null;

    return {
      current_class: currentClass,
      // Prisma maps the DB enum value (e.g. "A+") directly to the string
      blood_type: bloodType as string | null,
      emergency_contact: emergencyContact,
    };
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
    current_class?: string | null;
    blood_type?: string | null;
    emergency_contact?: QrEmergencyContact | null;
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
      current_class: input.current_class ?? null,
      blood_type: input.blood_type ?? null,
      emergency_contact: input.emergency_contact ?? null,
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

  // ── PDF rendering ──────────────────────────────────────────────────────────

  /**
   * Derives the sectional code (AV / CQ / GM) from the combined lowercased
   * club_name + section_name strings. Mirrors the logic in
   * `credencial_view_model.dart:_seccionFromCard`. Order matters: AV is
   * checked before CQ because "aventurero" contains no overlap with "conq".
   */
  private static resolveSeccionCode(
    clubName: string | null | undefined,
    sectionName: string | null | undefined,
  ): 'AV' | 'CQ' | 'GM' {
    const source = `${clubName ?? ''} ${sectionName ?? ''}`.toLowerCase();
    if (source.includes('avent')) return 'AV';
    if (source.includes('guia') || source.includes('guía') || source.includes('mayor')) return 'GM';
    if (source.includes('conq')) return 'CQ';
    return 'CQ'; // default — most common section in SACDIA
  }

  /** Palette keyed by SeccionCode. */
  private static readonly SECTION_PALETTE: Record<
    'AV' | 'CQ' | 'GM',
    { primary: string; primaryDark: string; accent: string }
  > = {
    AV: { primary: '#1F6FB5', primaryDark: '#143F66', accent: '#FFC72C' },
    CQ: { primary: '#C8102E', primaryDark: '#7A0A1C', accent: '#FFD400' },
    GM: { primary: '#0E7C3A', primaryDark: '#054021', accent: '#F2C94C' },
  };

  /**
   * Derives the folio string in the format SAC-YYYY-XXXX-XXXX.
   * Mirrors Flutter's `_folio()` fallback path (no cardIdShort on this side):
   * takes the last 8 chars of the JWT token, uppercases them, and splits
   * them 4-4 with a dash.
   */
  private static deriveFolio(token: string): string {
    const year = new Date().getFullYear();
    const suffix =
      token.length >= 8
        ? token.slice(-8).toUpperCase()
        : token.toUpperCase().padStart(8, '0');
    return `SAC-${year}-${suffix.slice(0, 4)}-${suffix.slice(4)}`;
  }

  private async drawCardPdf(
    doc: InstanceType<typeof PDFDocument>,
    card: QrCardResponse,
    avatarBuffer: Buffer | null,
  ): Promise<void> {
    const seccion = QrService.resolveSeccionCode(
      card.member.club_name,
      card.member.section_name,
    );
    const palette = QrService.SECTION_PALETTE[seccion];
    const folio = QrService.deriveFolio(card.token);

    // A6 portrait: 419.53 x 595.28 pt. Inner width with 18pt margins on each side.
    const pageW = 419.53;
    const marginH = 18;
    const contentW = pageW - marginH * 2;

    // ── 1. Header bar ──────────────────────────────────────────────────────
    const headerH = 72;
    const accentStripW = 6;

    // Header background (primaryDark)
    doc.rect(0, 0, pageW, headerH).fill(palette.primaryDark);

    // Accent strip on the right edge
    doc.rect(pageW - accentStripW, 0, accentStripW, headerH).fill(palette.accent);

    // 4pt accent bottom border
    doc.rect(0, headerH - 4, pageW - accentStripW, 4).fill(palette.accent);

    // Brand: "SACDIA" large + subtitle small — white, vertically centred
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('SACDIA', marginH, 16, { width: contentW - accentStripW });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text('Credencial virtual', marginH, 44, {
        width: contentW - accentStripW,
      });

    // Section acronym badge (top-right inside header, before accent strip)
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(palette.accent)
      .text(seccion, pageW - accentStripW - 36, 27, {
        width: 30,
        align: 'right',
      });

    // ── 2. Identity block ──────────────────────────────────────────────────
    let cursor = headerH + 16;

    const avatarSize = 56; // pt — circle diameter
    const avatarRadius = avatarSize / 2;
    const avatarCx = marginH + avatarRadius;
    const avatarCy = cursor + avatarRadius;

    // Text block starts to the right of the avatar with 12pt gap
    const textX = marginH + avatarSize + 12;
    const textW = contentW - avatarSize - 12;

    // ── Avatar circle (photo or initials fallback) ─────────────────────────
    if (avatarBuffer) {
      // Clip to circle, draw image, restore
      doc.save();
      doc.circle(avatarCx, avatarCy, avatarRadius).clip();
      doc.image(avatarBuffer, marginH, cursor, { fit: [avatarSize, avatarSize] });
      doc.restore();
    } else {
      // Filled circle in section primary colour
      doc.circle(avatarCx, avatarCy, avatarRadius).fill(palette.primary);

      // Compute 1- or 2-letter initials from full_name
      const words = card.member.full_name.trim().split(/\s+/);
      const initials =
        words.length >= 2
          ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
          : (words[0][0] ?? '?').toUpperCase();

      const initialsSize = initials.length === 1 ? 22 : 18;
      // Vertically centre text inside the circle
      const initialsY = avatarCy - initialsSize * 0.38;
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(initialsSize)
        .text(initials, marginH, initialsY, {
          width: avatarSize,
          align: 'center',
          lineBreak: false,
        });
    }

    // Border ring around avatar circle in accent colour (2pt)
    doc
      .circle(avatarCx, avatarCy, avatarRadius)
      .lineWidth(2)
      .strokeColor(palette.accent)
      .stroke();

    // Full name to the right of the avatar
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(card.member.full_name, textX, cursor, {
        width: textW,
        align: 'left',
      });

    // Advance cursor past the taller of the avatar circle or the name block
    const nameBlockH = doc.currentLineHeight(true);
    cursor += Math.max(avatarSize, nameBlockH) + 4;

    if (card.member.current_class) {
      doc
        .fillColor('#374151')
        .font('Helvetica')
        .fontSize(12)
        .text(card.member.current_class, textX, headerH + 16 + avatarSize - doc.currentLineHeight(true) - 2, {
          width: textW,
        });
    }

    // Thin rule below identity block
    cursor += 10;
    doc
      .moveTo(marginH, cursor)
      .lineTo(pageW - marginH, cursor)
      .strokeColor('#E5E7EB')
      .lineWidth(0.5)
      .stroke();
    cursor += 10;

    // ── 3. QR bitmap ──────────────────────────────────────────────────────
    const qrSize = 180;
    const qrBuffer = await QRCode.toBuffer(card.token, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: palette.primaryDark,
        light: '#FFFFFF',
      },
    });

    const qrX = marginH + (contentW - qrSize) / 2;
    doc.image(qrBuffer, qrX, cursor, { fit: [qrSize, qrSize], align: 'center' });
    cursor += qrSize + 10;

    // Folio label below QR
    doc
      .fillColor('#6B7280')
      .font('Courier')
      .fontSize(8)
      .text(folio, marginH, cursor, { width: contentW, align: 'center' });
    cursor += doc.currentLineHeight(true) + 14;

    // ── 4. Data grid (2 columns) ──────────────────────────────────────────
    const colW = (contentW - 8) / 2;
    const labelColor = '#6B7280';
    const valueColor = '#111827';

    interface GridItem { label: string; value: string }
    const gridItems: GridItem[] = [
      { label: 'CLUB', value: card.member.club_name ?? 'N/A' },
      { label: 'SECCIÓN', value: card.member.section_name ?? 'N/A' },
      { label: 'SANGRE', value: card.member.blood_type ?? '—' },
      { label: 'FOLIO', value: folio },
    ];

    for (let i = 0; i < gridItems.length; i += 2) {
      const left = gridItems[i];
      const right = gridItems[i + 1];

      // Left column
      doc
        .fillColor(labelColor)
        .font('Helvetica')
        .fontSize(9)
        .text(left.label, marginH, cursor, { width: colW });
      doc
        .fillColor(valueColor)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(left.value, marginH, cursor + 11, { width: colW });

      // Right column
      if (right) {
        const rightX = marginH + colW + 8;
        doc
          .fillColor(labelColor)
          .font('Helvetica')
          .fontSize(9)
          .text(right.label, rightX, cursor, { width: colW });
        doc
          .fillColor(valueColor)
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(right.value, rightX, cursor + 11, { width: colW });
      }

      cursor += 30;
    }

    // ── 5. Emergency contact card (conditional) ────────────────────────────
    if (card.member.emergency_contact) {
      const ec = card.member.emergency_contact;
      cursor += 6;
      const ecH = 54;
      const ecAccentW = 6;

      // Box fill
      doc.rect(marginH, cursor, contentW, ecH).fill('#FBE9EC');

      // Red accent strip on left
      doc.rect(marginH, cursor, ecAccentW, ecH).fill('#C8102E');

      // Label: "EMERGENCIA · {RELATIONSHIP}" uppercase
      const ecRelation = ec.relationship.toUpperCase();
      doc
        .fillColor('#6B7280')
        .font('Helvetica')
        .fontSize(9)
        .text(
          `EMERGENCIA · ${ecRelation}`,
          marginH + ecAccentW + 8,
          cursor + 6,
          { width: contentW - ecAccentW - 10 },
        );

      // Contact name
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(ec.name, marginH + ecAccentW + 8, cursor + 18, {
          width: contentW - ecAccentW - 10,
        });

      // Phone number (red, monospace)
      doc
        .fillColor('#C8102E')
        .font('Courier')
        .fontSize(12)
        .text(ec.phone, marginH + ecAccentW + 8, cursor + 34, {
          width: contentW - ecAccentW - 10,
        });

      cursor += ecH;
    }

    // ── 6. Footer ─────────────────────────────────────────────────────────
    const pageH = 595.28;
    const footerY = pageH - 42;

    doc
      .moveTo(marginH, footerY - 6)
      .lineTo(pageW - marginH, footerY - 6)
      .strokeColor('#E5E7EB')
      .lineWidth(0.5)
      .stroke();

    doc
      .fillColor('#9CA3AF')
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Iglesia Adventista del Séptimo Día · Ministerio Juvenil',
        marginH,
        footerY,
        { width: contentW * 0.65 },
      );

    doc
      .fillColor('#9CA3AF')
      .font('Courier')
      .fontSize(8)
      .text('sacdia.org', marginH + contentW * 0.65, footerY, {
        width: contentW * 0.35,
        align: 'right',
      });

    doc
      .fillColor('#9CA3AF')
      .font('Courier')
      .fontSize(9)
      .text(folio, marginH, footerY + 12, {
        width: contentW,
        align: 'center',
      });
  }
}
