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
    const pool = new Pool({ connectionString });
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
