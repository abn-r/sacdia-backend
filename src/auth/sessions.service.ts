import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DeviceType,
  SessionItemDto,
  SessionListResponseDto,
  RevokeAllSessionsResponseDto,
} from './dto/session-response.dto';

// ---------------------------------------------------------------------------
// Device parsing helpers (inline — no external UA library needed)
// ---------------------------------------------------------------------------

/**
 * Infers `DeviceType` from a raw User-Agent string using simple keyword matching.
 * Order matters: iOS check before Android, both before generic web.
 */
function parseDeviceType(userAgent: string | null): DeviceType {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return 'ios';
  }
  if (ua.includes('android')) {
    return 'android';
  }
  if (
    ua.includes('mozilla') ||
    ua.includes('chrome') ||
    ua.includes('safari') ||
    ua.includes('firefox') ||
    ua.includes('edg') ||
    ua.includes('opera')
  ) {
    return 'web';
  }
  return 'unknown';
}

/**
 * Returns a short human-readable device/browser name from a User-Agent string.
 * Returns null when the UA is absent or unrecognizable.
 */
function parseDeviceName(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipod')) return 'iPod';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('edg')) return 'Edge';
  if (ua.includes('firefox')) return 'Firefox';
  if (ua.includes('chrome')) return 'Chrome';
  if (ua.includes('safari')) return 'Safari';
  if (ua.includes('mozilla')) return 'Browser';
  return null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * SessionsService — manages active BA sessions stored in the `sessions` table.
 *
 * Uses the Prisma `session` model (@@map("sessions")) from the Better Auth schema.
 * All mutations operate directly on the DB row — no Redis intermediary for
 * session presence (Redis is used only by TokenBlacklistService for JWT revocation).
 *
 * IP masking policy: IPs are returned as-is (stored by BA at login time).
 * Full GeoIP enrichment is a TODO once a provider is selected.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  /**
   * Returns all non-expired sessions for `userId`, annotated with `is_current`.
   *
   * @param userId     - The authenticated user's UUID (from JWT `sub`)
   * @param currentSid - The `sid` claim from the JWT; null for legacy tokens
   */
  async listSessions(
    userId: string,
    currentSid: string | null,
  ): Promise<SessionListResponseDto> {
    const now = new Date();

    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    const sessions: SessionItemDto[] = rows.map((row) => ({
      session_id: row.id,
      device_type: parseDeviceType(row.userAgent),
      device_name: parseDeviceName(row.userAgent),
      ip_address: row.ipAddress ?? null,
      location: null, // TODO: GeoIP enrichment
      user_agent: row.userAgent ?? null,
      created_at: row.createdAt.toISOString(),
      last_active_at: row.updatedAt.toISOString(),
      is_current: currentSid !== null && row.id === currentSid,
      expires_at: row.expiresAt.toISOString(),
    }));

    return {
      sessions,
      current_session_id: currentSid,
    };
  }

  // ---------------------------------------------------------------------------
  // Revoke single
  // ---------------------------------------------------------------------------

  /**
   * Revokes a single session by deleting it from the DB.
   *
   * Guards:
   * - 400 if `sessionId === currentSid` (must use POST /auth/logout instead)
   * - 403 if the session belongs to a different user
   * - 404 if the session doesn't exist or is already expired
   */
  async revokeSession(
    userId: string,
    currentSid: string | null,
    sessionId: string,
  ): Promise<void> {
    if (currentSid !== null && sessionId === currentSid) {
      throw new AppBadRequestException(ErrorCode.AUTH_SESSION_IS_CURRENT, { sessionId });
    }

    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, expiresAt: true },
    });

    if (!row || row.expiresAt <= new Date()) {
      throw new AppNotFoundException(ErrorCode.AUTH_SESSION_NOT_FOUND, { sessionId });
    }

    if (row.userId !== userId) {
      // Log the attempted cross-user revocation for audit purposes
      this.logger.warn(
        JSON.stringify({
          event: 'sessions_cross_user_revoke_attempt',
          requestedBy: userId,
          sessionOwner: row.userId,
          sessionId,
        }),
      );
      throw new AppForbiddenException(ErrorCode.AUTH_SESSION_NOT_OWNED, { sessionId });
    }

    await this.prisma.session.delete({ where: { id: sessionId } });

    this.logger.log(
      JSON.stringify({
        event: 'session_revoked',
        userId,
        sessionId,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Revoke all others
  // ---------------------------------------------------------------------------

  /**
   * Revokes all sessions for `userId` except the caller's current session.
   *
   * When `currentSid` is null (legacy JWT without sid claim) all sessions
   * are revoked — the caller must re-authenticate immediately after.
   *
   * Returns the count of revoked sessions.
   */
  async revokeAllOtherSessions(
    userId: string,
    currentSid: string | null,
  ): Promise<RevokeAllSessionsResponseDto> {
    const now = new Date();

    const where =
      currentSid !== null
        ? { userId, id: { not: currentSid }, expiresAt: { gt: now } }
        : { userId, expiresAt: { gt: now } };

    const { count } = await this.prisma.session.deleteMany({ where });

    this.logger.log(
      JSON.stringify({
        event: 'sessions_revoke_all_others',
        userId,
        currentSid,
        revoked: count,
      }),
    );

    return { revoked_count: count };
  }
}
