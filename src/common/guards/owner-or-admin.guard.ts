import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard que permite acceso si:
 * 1. El usuario es el propietario del recurso (userId en params coincide con el usuario autenticado)
 * 2. El usuario tiene un rol global administrativo (admin, coordinator, super_admin)
 */
@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new ForbiddenException('User not authenticated');
    }

    // Obtener userId de los parámetros de la ruta
    const resourceUserId = request.params?.userId;

    if (!resourceUserId) {
      throw new ForbiddenException('User ID not found in request parameters');
    }

    // Caso 1: El usuario es el propietario
    if (user.sub === resourceUserId) {
      return true;
    }

    // Caso 2: El usuario tiene rol administrativo global
    const isAdmin = await this.checkAdminRole(user.sub);

    if (isAdmin) {
      return true;
    }

    throw new ForbiddenException(
      'You can only access your own resources unless you have admin privileges',
    );
  }

  private async checkAdminRole(userId: string): Promise<boolean> {
    const adminRoles = ['admin', 'coordinator', 'super_admin'];

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

    const activeRoleNames = userRoles
      .filter((ur) => ur.roles.active)
      .map((ur) => ur.roles.role_name.toLowerCase());

    return adminRoles.some((adminRole) =>
      activeRoleNames.includes(adminRole.toLowerCase()),
    );
  }
}
