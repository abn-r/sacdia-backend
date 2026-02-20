import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, role_category } from '@prisma/client';
import {
  createPaginatedResult,
  PaginationDto,
} from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListUsersQueryDto } from './dto';

type ScopeType = 'ALL' | 'UNION' | 'LOCAL_FIELD';

interface ActorScope {
  type: ScopeType;
  roles: string[];
  unionId?: number;
  localFieldId?: number;
}

interface ScopeMeta {
  type: ScopeType;
  roles: string[];
  union_id: number | null;
  local_field_id: number | null;
}

interface AdminUsersListResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    scope: ScopeMeta;
  };
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    actorUserId: string,
    query: AdminListUsersQueryDto,
  ): Promise<AdminUsersListResult<any>> {
    const scope = await this.resolveScope(actorUserId);

    const pagination = new PaginationDto();
    pagination.page = query.page ?? 1;
    pagination.limit = query.limit ?? 20;

    const where = this.buildListWhere(scope, query);

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          user_id: true,
          email: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          active: true,
          access_app: true,
          access_panel: true,
          country_id: true,
          union_id: true,
          local_field_id: true,
          created_at: true,
          countries: {
            select: {
              country_id: true,
              name: true,
            },
          },
          unions: {
            select: {
              union_id: true,
              name: true,
            },
          },
          local_fields: {
            select: {
              local_field_id: true,
              union_id: true,
              name: true,
            },
          },
          users_roles: {
            where: {
              active: true,
              roles: {
                active: true,
                role_category: role_category.GLOBAL,
              },
            },
            select: {
              roles: {
                select: {
                  role_name: true,
                },
              },
            },
          },
          users_pr: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
              complete: true,
              profile_picture_complete: true,
              personal_info_complete: true,
              club_selection_complete: true,
            },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    const data = users.map((user) => this.toListItem(user));
    const paginated = createPaginatedResult(data, total, pagination);

    return {
      data: paginated.data,
      meta: {
        ...paginated.meta,
        scope: this.toScopeMeta(scope),
      },
    };
  }

  async getUserById(actorUserId: string, userId: string) {
    const scope = await this.resolveScope(actorUserId);

    const filters: Prisma.usersWhereInput[] = [{ user_id: userId }];
    const scopedFilter = this.buildScopeWhere(scope);
    if (Object.keys(scopedFilter).length > 0) {
      filters.push(scopedFilter);
    }

    const user = await this.prisma.users.findFirst({
      where: { AND: filters },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        blood: true,
        baptism: true,
        baptism_date: true,
        user_image: true,
        active: true,
        access_app: true,
        access_panel: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        created_at: true,
        modified_at: true,
        countries: {
          select: {
            country_id: true,
            name: true,
          },
        },
        unions: {
          select: {
            union_id: true,
            name: true,
          },
        },
        local_fields: {
          select: {
            local_field_id: true,
            union_id: true,
            name: true,
          },
        },
        users_roles: {
          where: {
            active: true,
            roles: {
              active: true,
              role_category: role_category.GLOBAL,
            },
          },
          select: {
            role_id: true,
            roles: {
              select: {
                role_name: true,
              },
            },
          },
        },
        users_pr: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            complete: true,
            profile_picture_complete: true,
            personal_info_complete: true,
            club_selection_complete: true,
            date_completed: true,
          },
        },
        users_classes: {
          where: { active: true },
          orderBy: { created_at: 'desc' },
          select: {
            user_class_id: true,
            class_id: true,
            investiture: true,
            date_investiture: true,
            advanced: true,
            current_class: true,
            classes: {
              select: {
                name: true,
              },
            },
          },
        },
        club_role_assignments: {
          where: { active: true },
          orderBy: { created_at: 'desc' },
          select: {
            assignment_id: true,
            role_id: true,
            club_adv_id: true,
            club_pathf_id: true,
            club_mg_id: true,
            ecclesiastical_year_id: true,
            start_date: true,
            end_date: true,
            roles: {
              select: {
                role_name: true,
              },
            },
            ecclesiastical_year: {
              select: {
                year_id: true,
                start_date: true,
                end_date: true,
              },
            },
            club_adventurers: {
              select: {
                club_adv_id: true,
                clubs: {
                  select: {
                    club_id: true,
                    name: true,
                  },
                },
              },
            },
            club_pathfinders: {
              select: {
                club_pathf_id: true,
                clubs: {
                  select: {
                    club_id: true,
                    name: true,
                  },
                },
              },
            },
            club_master_guild: {
              select: {
                club_mg_id: true,
                clubs: {
                  select: {
                    club_id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        emergency_contact: {
          where: { active: true },
          orderBy: { created_at: 'desc' },
          select: {
            emergency_id: true,
            name: true,
            phone: true,
            primary: true,
            relationship_type: true,
          },
        },
        legal_representative: {
          select: {
            id: true,
            representative_user_id: true,
            relationship_type_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            phone: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado o fuera de alcance');
    }

    return {
      ...this.toListItem(user),
      gender: user.gender,
      birthday: user.birthday,
      blood: user.blood,
      baptism: user.baptism,
      baptism_date: user.baptism_date,
      user_image: user.user_image,
      modified_at: user.modified_at,
      classes: user.users_classes.map((item) => ({
        user_class_id: item.user_class_id,
        class_id: item.class_id,
        class_name: item.classes?.name ?? null,
        investiture: item.investiture,
        date_investiture: item.date_investiture,
        advanced: item.advanced,
        current_class: item.current_class,
      })),
      club_assignments: user.club_role_assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id,
        role_name: assignment.roles.role_name,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        ecclesiastical_year: assignment.ecclesiastical_year,
        club: this.resolveClubAssignment(assignment),
      })),
      emergency_contacts: user.emergency_contact,
      legal_representative: user.legal_representative,
      scope: this.toScopeMeta(scope),
    };
  }

  private async resolveScope(actorUserId: string): Promise<ActorScope> {
    const actor = await this.prisma.users.findUnique({
      where: { user_id: actorUserId },
      select: {
        user_id: true,
        union_id: true,
        local_field_id: true,
        users_roles: {
          where: {
            active: true,
            roles: {
              active: true,
              role_category: role_category.GLOBAL,
            },
          },
          select: {
            roles: {
              select: {
                role_name: true,
              },
            },
          },
        },
      },
    });

    if (!actor) {
      throw new ForbiddenException('Usuario actor no encontrado');
    }

    const roles = this.extractRoleNames(actor.users_roles);

    if (roles.includes('super_admin')) {
      return { type: 'ALL', roles };
    }

    if (roles.includes('admin')) {
      if (actor.union_id) {
        return { type: 'UNION', roles, unionId: actor.union_id };
      }

      if (actor.local_field_id) {
        return { type: 'LOCAL_FIELD', roles, localFieldId: actor.local_field_id };
      }

      throw new ForbiddenException(
        'Admin sin alcance configurado: requiere union_id o local_field_id',
      );
    }

    if (roles.includes('coordinator')) {
      if (actor.local_field_id) {
        return { type: 'LOCAL_FIELD', roles, localFieldId: actor.local_field_id };
      }

      throw new ForbiddenException(
        'Coordinator sin alcance configurado: requiere local_field_id',
      );
    }

    throw new ForbiddenException(
      'No tienes permisos globales para consultar usuarios administrativos',
    );
  }

  private buildListWhere(
    scope: ActorScope,
    query: AdminListUsersQueryDto,
  ): Prisma.usersWhereInput {
    const filters: Prisma.usersWhereInput[] = [];
    const scopedFilter = this.buildScopeWhere(scope);

    if (Object.keys(scopedFilter).length > 0) {
      filters.push(scopedFilter);
    }

    if (typeof query.active === 'boolean') {
      filters.push({ active: query.active });
    }

    const search = query.search?.trim();
    if (search) {
      filters.push({
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { paternal_last_name: { contains: search, mode: 'insensitive' } },
          { maternal_last_name: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const role = query.role?.trim();
    if (role) {
      filters.push({
        users_roles: {
          some: {
            active: true,
            roles: {
              active: true,
              role_category: role_category.GLOBAL,
              role_name: {
                equals: role,
                mode: 'insensitive',
              },
            },
          },
        },
      });
    }

    if (query.unionId) {
      filters.push({ union_id: query.unionId });
    }

    if (query.localFieldId) {
      filters.push({ local_field_id: query.localFieldId });
    }

    if (filters.length === 0) {
      return {};
    }

    if (filters.length === 1) {
      return filters[0];
    }

    return { AND: filters };
  }

  private buildScopeWhere(scope: ActorScope): Prisma.usersWhereInput {
    if (scope.type === 'ALL') {
      return {};
    }

    if (scope.type === 'UNION') {
      return { union_id: scope.unionId! };
    }

    return { local_field_id: scope.localFieldId! };
  }

  private toScopeMeta(scope: ActorScope): ScopeMeta {
    return {
      type: scope.type,
      roles: scope.roles,
      union_id: scope.unionId ?? null,
      local_field_id: scope.localFieldId ?? null,
    };
  }

  private extractRoleNames(
    assignments: Array<{ roles: { role_name: string } }>,
  ): string[] {
    return [...new Set(assignments.map((item) => item.roles.role_name))];
  }

  private toListItem(user: any) {
    const roles = this.extractRoleNames(user.users_roles).sort((a, b) =>
      a.localeCompare(b),
    );
    const postRegistration = user.users_pr[0]
      ? {
          complete: user.users_pr[0].complete,
          profile_picture_complete: user.users_pr[0].profile_picture_complete,
          personal_info_complete: user.users_pr[0].personal_info_complete,
          club_selection_complete: user.users_pr[0].club_selection_complete,
        }
      : null;

    return {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
      paternal_last_name: user.paternal_last_name,
      maternal_last_name: user.maternal_last_name,
      full_name: [user.name, user.paternal_last_name, user.maternal_last_name]
        .filter(Boolean)
        .join(' ')
        .trim(),
      active: user.active,
      access_app: user.access_app,
      access_panel: user.access_panel,
      country: user.countries
        ? {
            country_id: user.countries.country_id,
            name: user.countries.name,
          }
        : null,
      union: user.unions
        ? {
            union_id: user.unions.union_id,
            name: user.unions.name,
          }
        : null,
      local_field: user.local_fields
        ? {
            local_field_id: user.local_fields.local_field_id,
            union_id: user.local_fields.union_id,
            name: user.local_fields.name,
          }
        : null,
      roles,
      post_registration: postRegistration,
      created_at: user.created_at,
    };
  }

  private resolveClubAssignment(assignment: any) {
    if (assignment.club_adventurers) {
      return {
        type: 'adventurers',
        instance_id: assignment.club_adventurers.club_adv_id,
        club: assignment.club_adventurers.clubs,
      };
    }

    if (assignment.club_pathfinders) {
      return {
        type: 'pathfinders',
        instance_id: assignment.club_pathfinders.club_pathf_id,
        club: assignment.club_pathfinders.clubs,
      };
    }

    if (assignment.club_master_guild) {
      return {
        type: 'master_guides',
        instance_id: assignment.club_master_guild.club_mg_id,
        club: assignment.club_master_guild.clubs,
      };
    }

    return null;
  }
}
