import { createHash } from 'crypto';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { withTimeout } from '../utils/with-timeout';

/**
 * Result of a revocation lookup.
 * - `revoked`: the cache says the token / user tokens were revoked.
 * - `ok`: the cache was reachable and holds no revocation.
 * - `unavailable`: the cache could not be consulted (error, timeout or the
 *   circuit breaker is open). NOT a statement about the token: callers must
 *   apply their degraded-mode policy instead of treating it as ok or revoked.
 */
export type RevocationStatus = 'revoked' | 'ok' | 'unavailable';

/** After a cache failure, skip the cache entirely for this long. */
export const BLACKLIST_BREAKER_COOLDOWN_MS = 15_000;
/**
 * Upper bound per cache call. The Redis cache store can otherwise take ~5s
 * (connect race) or hang (offline queue) per call, which on the auth hot path
 * would add that latency to every request.
 */
export const BLACKLIST_OP_TIMEOUT_MS = 2_000;

type GuardedRead<T> = { available: true; value: T } | { available: false };

/**
 * Servicio para manejar blacklist de tokens JWT.
 * Almacena tokens revocados hasta que expiren.
 *
 * Reads are protected by a small circuit breaker (same idea as the cooldown in
 * RedisThrottlerStorage): after a cache failure the cache is skipped for
 * BLACKLIST_BREAKER_COOLDOWN_MS, one error is logged per outage and one line
 * on recovery. While the breaker is open a single probe request is let through
 * once the cooldown elapses; concurrent requests keep getting `unavailable`.
 * Writes always try the cache (a revocation must not be dropped just because
 * the breaker is open) and still feed the breaker state.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly BLACKLIST_PREFIX = 'token:blacklist:';
  private degraded = false;
  private unavailableUntil = 0;
  private probing = false;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Añadir un token a la blacklist.
   * @param token - Token JWT a revocar
   * @param expiresInSeconds - Tiempo hasta que el token expire
   */
  async blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
    const key = this.getBlacklistKey(token);
    await this.guardedWrite(() =>
      this.cacheManager.set(key, 'revoked', expiresInSeconds * 1000),
    );
    this.logger.log(`Token blacklisted, expires in ${expiresInSeconds}s`);
  }

  /**
   * Verificar si un token está en la blacklist.
   * @param token - Token JWT a verificar
   * @returns `revoked`, `ok` o `unavailable` (cache caído / breaker abierto)
   */
  async checkToken(token: string): Promise<RevocationStatus> {
    const key = this.getBlacklistKey(token);
    const read = await this.guardedRead(() =>
      this.cacheManager.get<string>(key),
    );
    if (!read.available) return 'unavailable';
    return read.value === 'revoked' ? 'revoked' : 'ok';
  }

  /**
   * Revocar todos los tokens de un usuario.
   * Útil para logout de todas las sesiones.
   * @param userId - ID del usuario
   * @param expiresInSeconds - TTL del registro
   */
  async blacklistAllUserTokens(
    userId: string,
    expiresInSeconds: number = 86400,
  ): Promise<void> {
    const key = `${this.BLACKLIST_PREFIX}user:${userId}:all`;
    const timestampSeconds = Math.floor(Date.now() / 1000);
    await this.guardedWrite(() =>
      this.cacheManager.set(
        key,
        timestampSeconds.toString(),
        expiresInSeconds * 1000,
      ),
    );
    this.logger.warn(`All tokens blacklisted for user ${userId}`);
  }

  /**
   * Verificar si todos los tokens de un usuario están bloqueados.
   * @param userId - ID del usuario
   * @param tokenIssuedAt - Timestamp de emisión del token
   * @returns `revoked` si el token fue emitido antes del bloqueo,
   * `unavailable` si el cache no pudo consultarse
   */
  async checkUserTokens(
    userId: string,
    tokenIssuedAt: number,
  ): Promise<RevocationStatus> {
    const key = `${this.BLACKLIST_PREFIX}user:${userId}:all`;
    const read = await this.guardedRead(() =>
      this.cacheManager.get<string>(key),
    );
    if (!read.available) return 'unavailable';

    const blacklistTime = read.value;
    if (!blacklistTime) return 'ok';

    const parsed = parseInt(blacklistTime, 10);
    if (Number.isNaN(parsed)) return 'ok';

    const normalizedSeconds = this.normalizeEpochSeconds(parsed);

    // Si el token fue emitido antes del bloqueo, está revocado
    return tokenIssuedAt < normalizedSeconds ? 'revoked' : 'ok';
  }

  private async guardedRead<T>(
    operation: () => Promise<T>,
  ): Promise<GuardedRead<T>> {
    const now = Date.now();
    let isProbe = false;
    if (this.degraded) {
      // Breaker open: skip the cache during the cooldown, and afterwards let
      // exactly one probe through while the rest keep short-circuiting.
      if (now < this.unavailableUntil || this.probing) {
        return { available: false };
      }
      this.probing = true;
      isProbe = true;
    }

    try {
      const value = await withTimeout(
        operation(),
        BLACKLIST_OP_TIMEOUT_MS,
        `Token blacklist cache call timed out after ${BLACKLIST_OP_TIMEOUT_MS} ms`,
      );
      this.markHealthy();
      return { available: true, value };
    } catch (error) {
      this.markUnavailable(error);
      return { available: false };
    } finally {
      if (isProbe) this.probing = false;
    }
  }

  /** Throws on failure (callers decide what to do) but feeds the breaker. */
  private async guardedWrite(operation: () => Promise<unknown>): Promise<void> {
    try {
      await withTimeout(
        operation(),
        BLACKLIST_OP_TIMEOUT_MS,
        `Token blacklist cache call timed out after ${BLACKLIST_OP_TIMEOUT_MS} ms`,
      );
    } catch (error) {
      this.markUnavailable(error);
      throw error;
    }
    this.markHealthy();
  }

  private markUnavailable(error: unknown): void {
    this.unavailableUntil = Date.now() + BLACKLIST_BREAKER_COOLDOWN_MS;
    if (this.degraded) return;
    this.degraded = true;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Token blacklist cache unavailable (${message}); revocation checks are degraded and the cache is skipped for ${BLACKLIST_BREAKER_COOLDOWN_MS} ms between probes`,
    );
  }

  private markHealthy(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.unavailableUntil = 0;
    this.logger.log(
      'Token blacklist cache recovered; revocation checks are normal again',
    );
  }

  private getBlacklistKey(token: string): string {
    // Usar hash corto del token para la key
    const hash = this.hashToken(token);
    return `${this.BLACKLIST_PREFIX}${hash}`;
  }

  private hashToken(token: string): string {
    // Full 64-character SHA-256 hex digest — truncation increases collision risk
    return createHash('sha256').update(token).digest('hex');
  }

  private normalizeEpochSeconds(timestamp: number): number {
    // Compatibilidad: valores históricos en milisegundos.
    return timestamp > 1_000_000_000_000
      ? Math.floor(timestamp / 1000)
      : timestamp;
  }
}
