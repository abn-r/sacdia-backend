import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

@Injectable()
export class AuthorizationContextVersionService {
  constructor(private readonly prisma: PrismaService) {}
  async current(userId: string): Promise<bigint> {
    const record = await this.prisma.authorization_context_versions.findUnique({
      where: { user_id: userId },
      select: { version: true },
    });
    return record?.version ?? 0n;
  }
  async bump(tx: Prisma.TransactionClient, userId: string): Promise<bigint> {
    const record = await tx.authorization_context_versions.upsert({
      where: { user_id: userId },
      create: { user_id: userId, version: 1n },
      update: { version: { increment: 1n } },
      select: { version: true },
    });
    return record.version;
  }
}
