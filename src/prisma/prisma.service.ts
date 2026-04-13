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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');

    // Neon cold-start mitigation: default idleTimeoutMillis is 10s which causes
    // a new TCP handshake + TLS negotiation on every request after brief idle.
    // keepAlive prevents the OS from closing the TCP connection silently,
    // and idleTimeoutMillis: 30000 gives Neon enough time to reuse the slot.
    const pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    const adapter = new PrismaPg(pool);

    const isProduction = process.env.NODE_ENV === 'production';

    super({
      adapter,
      ...(isProduction ? {} : { log: [{ emit: 'event', level: 'query' }] }),
    });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();

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
    await this.$disconnect();
    await this.pool.end();
  }
}
