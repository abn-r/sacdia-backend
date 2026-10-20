import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  getAuditCorrelationId,
  markExplicitAuditRecorded,
} from '../audit-logs/audit-request-context';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  BetterAuthService,
  DEVICE_SESSION_DURATION_MS,
  type SessionRequestContext,
} from '../better-auth/better-auth.service';
import { ageToday } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { PairDeviceDto } from './dto/pair-device.dto';
import {
  DEVICE_PAIRING_MAX_FAILURES,
  DevicePairingFailureCounter,
} from './device-pairing-failure-counter';
import {
  deriveDevicePairingTokenKey,
  generatePairingToken,
  hashPairingToken,
  isWellFormedPairingToken,
  pairingQrPayload,
} from './device-pairing-token.util';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import { VISIBLE_DEPENDENT, lockDependent } from './guardianship-queries';
import {
  DEVICE_ABSOLUTE_LIFETIME_MS,
  DEVICE_PAIRING_TOKEN_TTL_MS,
  MAX_LINKED_DEVICES_PER_DEPENDENT,
} from './guardianships.constants';

export type PairingIneligibleReason =
  | 'consent_not_verified'
  | 'has_supervised_login'
  | 'age_not_under_min_self_login'
  | 'custodian_only';

export interface IssuedPairingToken {
  pairing_token: string;
  qr_payload: string;
  expires_at: string;
  expires_in: number;
}

export interface PairedDevice {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds: when the device SESSION (refresh token) expires. */
  expiresAt: number;
  tokenType: 'bearer';
  device: { linked_device_id: string; label: string };
  user: { id: string; name: string; avatar: string | null };
}

/** Label kept when the phone sends none or only characters that get stripped. */
const DEFAULT_DEVICE_LABEL = 'Dispositivo';
const MAX_LABEL_LENGTH = 40;
const MAX_APP_VERSION_LENGTH = 32;
// C0/C1 control characters, and the characters that make markup.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_MARKUP = /[\u0000-\u001F\u007F-\u009F<>]/g;

function pairingTokenInvalid(): AppException {
  return new AppException(
    ErrorCode.DEVICE_PAIRING_TOKEN_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}

function limitReached(): AppException {
  return new AppException(ErrorCode.DEVICE_LIMIT_REACHED, HttpStatus.CONFLICT, {
    max_devices: MAX_LINKED_DEVICES_PER_DEPENDENT,
  });
}

function notEligible(reason: PairingIneligibleReason): AppException {
  return new AppException(
    ErrorCode.DEVICE_PAIRING_NOT_ELIGIBLE,
    HttpStatus.UNPROCESSABLE_ENTITY,
    undefined,
    { reason },
  );
}

/** Label from the child's phone: no control characters, no markup, <= 40 chars. */
export function sanitizeDeviceLabel(raw: string | undefined): string {
  const cleaned = (raw ?? '')
    .replace(CONTROL_OR_MARKUP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_DEVICE_LABEL;
}

function sanitizeAppVersion(raw: string | undefined): string | null {
  const cleaned = (raw ?? '')
    .replace(CONTROL_OR_MARKUP, '')
    .trim()
    .slice(0, MAX_APP_VERSION_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * QR pairing of a child's phone (Phase 3b, FP3-41/42).
 *
 * ISSUE (a VERIFIED, non-custodian, non-test guardian, as self): the child must
 * have NO account (a child with an own login is not a device child), be active,
 * not frozen, UNDER the minimum self-login age of its country (new pairings
 * only; existing devices keep working after that), and have fewer than 2 active
 * devices. The token is 128 random bits, stored only as an HMAC (HKDF key from
 * BETTER_AUTH_SECRET, own `info`), valid 10 minutes, single use; a new token
 * revokes the earlier open ones of the same child. It is never logged nor
 * audited.
 *
 * REDEEM (public): ONE transaction. Find the token by hash, lock the child, then
 * re-validate EVERYTHING issue() checked (the world may have changed since),
 * enforce the device cap under the lock, create the device session, the device
 * row, and finally consume the token with a compare-and-set (the loser of a
 * race rolls back and gets the uniform 400). Every failure that is about the
 * token or the family is the SAME 400 DEVICE_PAIRING_TOKEN_INVALID; only a
 * valid token on a child that already has two devices says 409.
 */
@Injectable()
export class DevicePairingService {
  private readonly logger = new Logger(DevicePairingService.name);
  private key: Buffer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: FamilyFeatureFlagsService,
    private readonly powers: GuardianPowersPolicy,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly betterAuth: BetterAuthService,
    private readonly actingForCache: ActingForCache,
    private readonly failures: DevicePairingFailureCounter,
    private readonly security: GuardianSecurityNotificationsService,
  ) {}

  private hashKey(): Buffer {
    if (!this.key) {
      const secret = this.config.get<string>('BETTER_AUTH_SECRET')?.trim();
      if (!secret) {
        throw new Error('BETTER_AUTH_SECRET is required for pairing tokens');
      }
      this.key = deriveDevicePairingTokenKey(secret);
    }
    return this.key;
  }

  // ---------------------------------------------------------------------------
  // Issue
  // ---------------------------------------------------------------------------

  async issue(
    guardianId: string,
    dependentId: string,
  ): Promise<IssuedPairingToken> {
    this.flags.assertEnabled('linked_device');
    // Pending guardian -> 403, stranger / custodian -> 404 (before any detail).
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);

    const token = generatePairingToken();
    const hash = hashPairingToken(token, this.hashKey());
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_PAIRING_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, dependentId);
      const guardianship = await this.powers.assertVerifiedGuardian(
        guardianId,
        dependentId,
        { db: tx },
      );
      const refusal = await this.checkDependentEligible(tx, dependentId);
      if (refusal === 'unavailable') {
        throw new AppException(
          ErrorCode.GUARDIANSHIP_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      if (refusal) throw notEligible(refusal);
      await this.assertUnderDeviceCap(tx, dependentId);

      // A new token kills the earlier open ones of this child.
      await tx.device_pairing_tokens.updateMany({
        where: {
          dependent_user_id: dependentId,
          consumed_at: null,
          revoked_at: null,
        },
        data: { revoked_at: now },
      });
      await tx.device_pairing_tokens.create({
        data: {
          token_hash: hash,
          dependent_user_id: dependentId,
          guardianship_id: guardianship.guardianship_id,
          created_by_user_id: guardianId,
          expires_at: expiresAt,
          created_at: now,
        },
      });
    });

    return {
      pairing_token: token,
      qr_payload: pairingQrPayload(token),
      expires_at: expiresAt.toISOString(),
      expires_in: Math.floor(DEVICE_PAIRING_TOKEN_TTL_MS / 1000),
    };
  }

  // ---------------------------------------------------------------------------
  // Redeem
  // ---------------------------------------------------------------------------

  async pair(
    dto: PairDeviceDto,
    context: SessionRequestContext,
  ): Promise<PairedDevice> {
    const ip = context.ipAddress ?? 'unknown';
    await this.assertIpNotLocked(ip);

    try {
      if (!this.flags.isEnabled('linked_device')) {
        throw pairingTokenInvalid();
      }
      if (!isWellFormedPairingToken(dto.pairing_token)) {
        throw pairingTokenInvalid();
      }
      return await this.redeem(dto, dto.pairing_token, context);
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.DEVICE_PAIRING_TOKEN_INVALID
      ) {
        await this.recordFailure(ip);
      }
      throw error;
    }
  }

  private async redeem(
    dto: PairDeviceDto,
    token: string,
    context: SessionRequestContext,
  ): Promise<PairedDevice> {
    const hash = hashPairingToken(token, this.hashKey());
    const label = sanitizeDeviceLabel(dto.label);
    const appVersion = sanitizeAppVersion(dto.app_version);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const probe = await tx.device_pairing_tokens.findUnique({
        where: { token_hash: hash },
        select: { dependent_user_id: true },
      });
      if (!probe) throw pairingTokenInvalid();

      // Serialize per child, then read again: everything below is decided
      // under the lock, so two phones or two tokens cannot both slip through.
      await lockDependent(tx, probe.dependent_user_id);
      const row = await tx.device_pairing_tokens.findUnique({
        where: { token_hash: hash },
        select: {
          pairing_token_id: true,
          dependent_user_id: true,
          guardianship_id: true,
          created_by_user_id: true,
          expires_at: true,
          consumed_at: true,
          revoked_at: true,
        },
      });
      if (
        !row ||
        row.consumed_at !== null ||
        row.revoked_at !== null ||
        row.expires_at.getTime() <= now.getTime()
      ) {
        throw pairingTokenInvalid();
      }

      const guardianship = await tx.guardianships.findFirst({
        where: {
          guardianship_id: row.guardianship_id,
          dependent_user_id: row.dependent_user_id,
          guardian_user_id: row.created_by_user_id,
          // verified, therefore not revoked either.
          consent_status: 'verified',
          is_custodian: false,
          is_test_data: false,
          dependent: VISIBLE_DEPENDENT,
        },
        select: { guardianship_id: true },
      });
      if (!guardianship) throw pairingTokenInvalid();

      // The family changed since the QR was made: indistinguishable from a
      // dead token (nothing to learn from an unauthenticated endpoint).
      if (await this.checkDependentEligible(tx, row.dependent_user_id)) {
        throw pairingTokenInvalid();
      }
      await this.assertUnderDeviceCap(tx, row.dependent_user_id);

      const deviceId = randomUUID();
      const session = await this.betterAuth.createSession(
        row.dependent_user_id,
        context,
        { durationMs: DEVICE_SESSION_DURATION_MS, tx },
      );
      await tx.linked_devices.create({
        data: {
          linked_device_id: deviceId,
          dependent_user_id: row.dependent_user_id,
          guardianship_id: row.guardianship_id,
          paired_by_user_id: row.created_by_user_id,
          session_id: session.id,
          label,
          platform: dto.platform,
          app_version: appVersion,
          paired_at: now,
          absolute_expires_at: new Date(
            now.getTime() + DEVICE_ABSOLUTE_LIFETIME_MS,
          ),
        },
      });
      // Compare and set: the loser of a race on the same token finds it taken.
      const consumed = await tx.device_pairing_tokens.updateMany({
        where: {
          pairing_token_id: row.pairing_token_id,
          consumed_at: null,
          revoked_at: null,
          expires_at: { gt: now },
        },
        data: { consumed_at: now, consumed_device_id: deviceId },
      });
      if (consumed.count !== 1) throw pairingTokenInvalid();

      markExplicitAuditRecorded();
      await tx.audit_logs.create({
        data: {
          entity_type: 'linked_device',
          entity_id: deviceId,
          action: 'linked_device.paired',
          actor_user_id: row.dependent_user_id,
          actor_kind: 'linked_device',
          target_user_id: row.dependent_user_id,
          summary: 'Dispositivo vinculado',
          // The token itself is NEVER recorded.
          changes: { platform: dto.platform, label },
          request_context: {
            linked_device_id: deviceId,
            paired_by: row.created_by_user_id,
          },
          result: 'succeeded',
          source: 'service',
          correlation_id: getAuditCorrelationId() ?? null,
          effective_at: now,
        },
      });

      const dependent = await tx.users.findUniqueOrThrow({
        where: { user_id: row.dependent_user_id },
        select: { name: true, user_image: true },
      });
      return {
        deviceId,
        dependentId: row.dependent_user_id,
        session,
        dependent,
      };
    });

    await this.actingForCache.bump(outcome.dependentId);
    void this.security
      .onDevicePaired({
        dependentUserId: outcome.dependentId,
        label,
        platform: dto.platform,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Device paired notice failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    const accessToken = this.betterAuth.signDeviceJwt({
      dependentUserId: outcome.dependentId,
      sessionId: outcome.session.id,
      linkedDeviceId: outcome.deviceId,
    });
    return {
      accessToken,
      refreshToken: outcome.session.token,
      expiresAt: Math.floor(outcome.session.expiresAt.getTime() / 1000),
      tokenType: 'bearer',
      // Only what the child's app needs: no guardian contact data, no last
      // names, no other children, never the pairing token.
      device: { linked_device_id: outcome.deviceId, label },
      user: {
        id: outcome.dependentId,
        name: firstNameOf(outcome.dependent.name),
        avatar: outcome.dependent.user_image ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Preconditions (shared by issue and redeem)
  // ---------------------------------------------------------------------------

  /**
   * Whether the child can get a NEW device right now. Null when it can;
   * `unavailable` when it is not an active, unfrozen dependent at all (issue
   * answers the plain 404 of the guardian powers); otherwise the reason.
   */
  private async checkDependentEligible(
    tx: Prisma.TransactionClient,
    dependentId: string,
  ): Promise<PairingIneligibleReason | 'unavailable' | null> {
    const dependent = await tx.users.findUnique({
      where: { user_id: dependentId },
      select: {
        active: true,
        birthday: true,
        country_id: true,
        dependent_profile: { select: { frozen_at: true, purged_at: true } },
        supervised_login: { select: { user_id: true } },
        account: { select: { id: true }, take: 1 },
      },
    });
    const profile = dependent?.dependent_profile;
    if (
      !dependent ||
      !dependent.active ||
      !profile ||
      profile.frozen_at !== null ||
      profile.purged_at !== null
    ) {
      return 'unavailable';
    }

    // A child with an own login (or any account) is not a device child.
    if (dependent.account.length > 0 || dependent.supervised_login) {
      return 'has_supervised_login';
    }

    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    if (
      !dependent.birthday ||
      ageToday(dependent.birthday, policy.timeZone) >= policy.minSelfLoginAge
    ) {
      return 'age_not_under_min_self_login';
    }
    return null;
  }

  private async assertUnderDeviceCap(
    tx: Prisma.TransactionClient,
    dependentId: string,
  ): Promise<void> {
    const active = await tx.linked_devices.count({
      where: { dependent_user_id: dependentId, revoked_at: null },
    });
    if (active >= MAX_LINKED_DEVICES_PER_DEPENDENT) {
      throw limitReached();
    }
  }

  // ---------------------------------------------------------------------------
  // Abuse limits (public endpoint)
  // ---------------------------------------------------------------------------

  /** 30 failed redeems from one IP in a day => 429 even for a valid token. */
  private async assertIpNotLocked(ip: string): Promise<void> {
    let failures = 0;
    try {
      failures = await this.failures.current(ip);
    } catch (error) {
      // The route is also throttled per IP (5/min, 20/h): a counter outage
      // only loses the daily cap, it never opens anything new.
      this.logger.warn(
        `Pairing failure counter unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (failures >= DEVICE_PAIRING_MAX_FAILURES) {
      throw new AppException(
        ErrorCode.AUTH_LOGIN_LOCKED,
        HttpStatus.TOO_MANY_REQUESTS,
        { retry_after_seconds: 3600 },
      );
    }
  }

  private async recordFailure(ip: string): Promise<void> {
    try {
      await this.failures.increment(ip);
    } catch (error) {
      this.logger.warn(
        `Could not count a pairing failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function firstNameOf(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : DEFAULT_DEVICE_LABEL;
}
