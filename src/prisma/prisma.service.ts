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

    // Neon cold-start mitigation: default idleTimeoutMillis is 10s which causes
    // a new TCP handshake + TLS negotiation on every request after brief idle.
    // keepAlive prevents the OS from closing the TCP connection silently,
    // and idleTimeoutMillis: 30000 gives Neon enough time to reuse the slot.
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
