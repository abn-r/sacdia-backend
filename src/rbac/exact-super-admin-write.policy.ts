import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

type GlobalRoleAssignmentReader = Pick<PrismaService, 'users_roles'>;

@Injectable()
export class ExactSuperAdminWritePolicy {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: GlobalRoleAssignmentReader,
  ) {}

  async assert(
    actorUserId: string,
    reader: GlobalRoleAssignmentReader = this.prisma,
  ): Promise<void> {
    const assignment = await reader.users_roles.findFirst({
      where: {
        user_id: actorUserId,
        active: true,
        roles: {
          role_name: 'super-admin',
          role_category: 'GLOBAL',
          active: true,
        },
      },
      select: { user_role_id: true },
    });
    if (!assignment)
      throw new AppForbiddenException(ErrorCode.SUPER_ADMIN_WRITE_REQUIRED);
  }
}

@Injectable()
export class ExactSuperAdminWriteGuard implements CanActivate {
  constructor(private readonly policy: ExactSuperAdminWritePolicy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actorUserId = context.switchToHttp().getRequest().user?.sub;
    if (typeof actorUserId !== 'string' || actorUserId.length === 0)
      throw new AppForbiddenException(ErrorCode.SUPER_ADMIN_WRITE_REQUIRED);
    await this.policy.assert(actorUserId);
    return true;
  }
}
