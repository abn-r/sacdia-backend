import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { buildPrismaPoolConfig } from './prisma-pool.config';

// Connections pre-opened at startup so the first parallel burst (e.g. the
// auth-context fan-out) doesn't pay one TLS handshake per query.
const POOL_WARMUP_CONNECTIONS = 4;

export interface PrismaPoolMetrics {
  max: number;
  total: number;
  idle: number;
  active: number;
  waiting: number;
  utilization: number;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;
  private readonly poolMax: number;
  private readonly logger: Logger;

  constructor(private configService: ConfigService) {
    const poolConfig = buildPrismaPoolConfig(configService);
    const logger = new Logger(PrismaService.name);

    // Neon cold-start mitigation: pg's default idleTimeoutMillis is 10s which
    // causes a new TCP handshake + TLS negotiation on every request after a
    // brief idle. keepAlive prevents the OS from closing the TCP connection
    // silently, and idleTimeoutMillis (default 5 min, see prisma-pool.config)
    // keeps clients alive across typical admin-panel interaction gaps.
    // connectionTimeoutMillis defaults to 15s so dev/serverless Neon cold starts
    // have time to resume before Prisma gives up on the pooled connection.
    const pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool, {
      onPoolError: (error) => {
        logger.error(`PostgreSQL pool error: ${error.message}`, error.stack);
      },
    });

    const isProduction = process.env.NODE_ENV === 'production';

    super({
      adapter,
      ...(isProduction ? {} : { log: [{ emit: 'event', level: 'query' }] }),
    });

    this.pool = pool;
    this.poolMax = poolConfig.max ?? 10;
    this.logger = logger;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`PostgreSQL pool initialized (max=${this.poolMax})`);

    await this.warmUpPool();

    if (process.env.NODE_ENV !== 'production') {
      // Prisma 7 changed $on signature; cast to bypass strict check (dev-only)
      (this as any).$on('query', (e: any) => {
        if (e.duration > 100) {
          this.logger.warn(
            `Slow query (${e.duration}ms): ${e.query?.substring(0, 200)}`,
          );
        }
      });
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } finally {
      await this.pool.end();
    }
  }

  /**
   * Opens several connections in parallel so the pool is already warm when the
   * first request arrives. Failures are tolerated (e.g. Neon still resuming);
   * the pool will simply open connections lazily as usual.
   */
  private async warmUpPool(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(
        { length: POOL_WARMUP_CONNECTIONS },
        () => this.$queryRaw`SELECT 1`,
      ),
    );

    const ready = results.filter((r) => r.status === 'fulfilled').length;
    if (ready < POOL_WARMUP_CONNECTIONS) {
      this.logger.warn(
        `Pool warm-up partial (${ready}/${POOL_WARMUP_CONNECTIONS} connections ready)`,
      );
    } else {
      this.logger.log(
        `Pool warm-up complete (${ready} connections ready)`,
      );
    }
  }

  getPoolMetrics(): PrismaPoolMetrics {
    const total = this.pool.totalCount;
    const idle = this.pool.idleCount;
    const active = Math.max(0, total - idle);

    return {
      max: this.poolMax,
      total,
      idle,
      active,
      waiting: this.pool.waitingCount,
      utilization:
        this.poolMax === 0 ? 0 : Number((active / this.poolMax).toFixed(3)),
    };
  }
}
