import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

  /** Deduplicate and sort so concurrent bumpers lock rows in one order. */
  normalizeUserIds(userIds: readonly string[]): string[] {
    return [...new Set(userIds.filter(Boolean))].sort();
  }

  async bumpOrdered(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
  ): Promise<void> {
    for (const userId of this.normalizeUserIds(userIds)) {
      await this.bump(tx, userId);
    }
  }

  /** Set-based bump for bulk jobs; still normalizes IDs first. */
  async bumpMany(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
  ): Promise<number> {
    const sorted = this.normalizeUserIds(userIds);
    if (!sorted.length) return 0;
    await tx.authorization_context_versions.createMany({
      data: sorted.map((user_id) => ({ user_id, version: 0n })),
      skipDuplicates: true,
    });
    const result = await tx.authorization_context_versions.updateMany({
      where: { user_id: { in: sorted } },
      data: { version: { increment: 1 } },
    });
    return result.count;
  }
}
