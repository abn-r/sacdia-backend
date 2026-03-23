import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * EmailVerifiedGuard — opt-in guard to block unverified users.
 *
 * Usage: Apply @UseGuards(JwtAuthGuard, EmailVerifiedGuard) to any endpoint
 * that should require email verification. JwtAuthGuard MUST run first so that
 * request.user is populated.
 *
 * NOT applied globally — only added to endpoints that explicitly require it.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId?: string; sub?: string } | undefined;

    const userId = user?.userId ?? user?.sub;

    if (!userId) {
      throw new ForbiddenException('Debes verificar tu email antes de continuar');
    }

    const dbUser = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { email_verified: true },
    });

    if (!dbUser?.email_verified) {
      throw new ForbiddenException('Debes verificar tu email antes de continuar');
    }

    return true;
  }
}
