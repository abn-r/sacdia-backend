import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GLOBAL_ROLES_KEY,
  type GlobalRoleType,
} from '../decorators/global-roles.decorator';

@Injectable()
export class GlobalRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<GlobalRoleType[]>(
      GLOBAL_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no se requieren roles específicos, permitir
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new ForbiddenException('User not authenticated');
    }

    // Verificar si el usuario tiene alguno de los roles requeridos
    const hasRole = await this.checkUserGlobalRole(user.sub, requiredRoles);

    if (!hasRole) {
      throw new ForbiddenException(
        `You need one of these global roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }

  private async checkUserGlobalRole(
    userId: string,
    requiredRoles: GlobalRoleType[],
  ): Promise<boolean> {
    // Obtener roles activos del usuario desde users_roles
    const userRoles = await this.prisma.users_roles.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      include: {
        roles: {
          select: {
            role_name: true,
            active: true,
          },
        },
      },
    });

    // Filtrar solo roles activos y extraer nombres
    const activeRoleNames = userRoles
      .filter((ur) => ur.roles.active)
      .map((ur) => ur.roles.role_name.toLowerCase());

    // Verificar si alguno de los roles del usuario coincide con los requeridos
    return requiredRoles.some((requiredRole) =>
      activeRoleNames.includes(requiredRole.toLowerCase()),
    );
  }
}
