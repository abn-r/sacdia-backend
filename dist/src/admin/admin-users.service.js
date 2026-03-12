"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AdminUsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminUsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const authorization_context_service_1 = require("../common/services/authorization-context.service");
const sensitive_user_subresource_policy_1 = require("../common/guards/sensitive-user-subresource-policy");
const file_storage_service_1 = require("../common/services/file-storage.service");
const prisma_service_1 = require("../prisma/prisma.service");
let AdminUsersService = class AdminUsersService {
    static { AdminUsersService_1 = this; }
    prisma;
    authorizationContext;
    fileStorage;
    logger = new common_1.Logger(AdminUsersService_1.name);
    static PRIVATE_ASSET_URL_TTL_SECONDS = 300;
    constructor(prisma, authorizationContext, fileStorage) {
        this.prisma = prisma;
        this.authorizationContext = authorizationContext;
        this.fileStorage = fileStorage;
    }
    async listUsers(actorUserId, query) {
        const scope = await this.resolveScope(actorUserId);
        const pagination = new pagination_dto_1.PaginationDto();
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
                    user_image: true,
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
                                role_category: client_1.role_category.GLOBAL,
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
        const data = await Promise.all(users.map((user) => this.toListItem(user)));
        const paginated = (0, pagination_dto_1.createPaginatedResult)(data, total, pagination);
        return {
            data: paginated.data,
            meta: {
                ...paginated.meta,
                scope: this.toScopeMeta(scope),
            },
        };
    }
    async getUserById(actorUserId, userId) {
        const scope = await this.resolveScope(actorUserId);
        const resolvedAuthorization = await this.authorizationContext.resolveUserAuthorization(actorUserId);
        const actorGlobalPermissions = this.getActorGlobalPermissions(resolvedAuthorization);
        const filters = [{ user_id: userId }];
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
                            role_category: client_1.role_category.GLOBAL,
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
                        relationship_type_id: true,
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
                users_allergies: {
                    where: { active: true },
                    orderBy: { allergy_id: 'asc' },
                    select: {
                        allergy_id: true,
                        allergies: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                users_diseases: {
                    where: { active: true },
                    orderBy: { disease_id: 'asc' },
                    select: {
                        disease_id: true,
                        diseases: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                users_medicines: {
                    where: { active: true },
                    orderBy: { medicine_id: 'asc' },
                    select: {
                        medicine_id: true,
                        medicines: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado o fuera de alcance');
        }
        const listItem = await this.toListItem(user);
        const sensitiveBlocks = this.buildSensitiveBlocks(user, actorGlobalPermissions);
        return {
            ...listItem,
            gender: user.gender,
            birthday: user.birthday,
            blood: sensitiveBlocks.health ? user.blood : null,
            baptism: user.baptism,
            baptism_date: user.baptism_date,
            user_image: listItem.user_image,
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
            health: sensitiveBlocks.health,
            emergency_contacts: sensitiveBlocks.emergency_contacts,
            legal_representative: sensitiveBlocks.legal_representative,
            post_registration: sensitiveBlocks.post_registration,
            scope: this.toScopeMeta(scope),
        };
    }
    getActorGlobalPermissions(resolvedAuthorization) {
        return new Set(resolvedAuthorization.authorization.grants.global_roles.flatMap((grant) => grant.permissions));
    }
    buildSensitiveBlocks(user, actorGlobalPermissions) {
        return {
            health: this.canReadSensitiveFamily(actorGlobalPermissions, 'health')
                ? this.buildHealthBlock(user)
                : null,
            emergency_contacts: this.canReadSensitiveFamily(actorGlobalPermissions, 'emergency_contacts')
                ? user.emergency_contact
                : null,
            legal_representative: this.canReadSensitiveFamily(actorGlobalPermissions, 'legal_representative')
                ? user.legal_representative
                : null,
            post_registration: this.canReadSensitiveFamily(actorGlobalPermissions, 'post_registration')
                ? this.buildMinimalPostRegistrationBlock(user)
                : null,
        };
    }
    canReadSensitiveFamily(actorGlobalPermissions, family) {
        const policy = (0, sensitive_user_subresource_policy_1.getSensitiveUserSubresourcePolicy)(family, 'read');
        return (actorGlobalPermissions.has(policy.finePermission) ||
            actorGlobalPermissions.has(policy.legacyFallbackPermission));
    }
    buildHealthBlock(user) {
        return {
            blood: user.blood,
            allergies: (user.users_allergies ?? []).map((item) => ({
                allergy_id: item.allergy_id,
                name: item.allergies?.name ?? null,
            })),
            diseases: (user.users_diseases ?? []).map((item) => ({
                disease_id: item.disease_id,
                name: item.diseases?.name ?? null,
            })),
            medicines: (user.users_medicines ?? []).map((item) => ({
                medicine_id: item.medicine_id,
                name: item.medicines?.name ?? null,
            })),
        };
    }
    buildMinimalPostRegistrationBlock(user) {
        const latestPostRegistration = user.users_pr?.[0];
        if (!latestPostRegistration) {
            return null;
        }
        return {
            complete: latestPostRegistration.complete,
            profile_picture_complete: latestPostRegistration.profile_picture_complete,
            personal_info_complete: latestPostRegistration.personal_info_complete,
            club_selection_complete: latestPostRegistration.club_selection_complete,
            date_completed: latestPostRegistration.date_completed ?? null,
        };
    }
    async resolveScope(actorUserId) {
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
                            role_category: client_1.role_category.GLOBAL,
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
            throw new common_1.ForbiddenException('Usuario actor no encontrado');
        }
        const roles = this.extractRoleNames(actor.users_roles);
        if (roles.includes('super_admin')) {
            return { type: 'ALL', roles };
        }
        const hasAdminLevelRole = roles.includes('admin') || roles.includes('assistant_admin');
        if (hasAdminLevelRole) {
            if (actor.union_id) {
                return { type: 'UNION', roles, unionId: actor.union_id };
            }
            if (actor.local_field_id) {
                return { type: 'LOCAL_FIELD', roles, localFieldId: actor.local_field_id };
            }
            throw new common_1.ForbiddenException('Admin/assistant_admin sin alcance configurado: requiere union_id o local_field_id');
        }
        if (roles.includes('coordinator')) {
            if (actor.local_field_id) {
                return { type: 'LOCAL_FIELD', roles, localFieldId: actor.local_field_id };
            }
            throw new common_1.ForbiddenException('Coordinator sin alcance configurado: requiere local_field_id');
        }
        throw new common_1.ForbiddenException('No tienes permisos globales para consultar usuarios administrativos');
    }
    buildListWhere(scope, query) {
        const filters = [];
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
                            role_category: client_1.role_category.GLOBAL,
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
    buildScopeWhere(scope) {
        if (scope.type === 'ALL') {
            return {};
        }
        if (scope.type === 'UNION') {
            return { union_id: scope.unionId };
        }
        return { local_field_id: scope.localFieldId };
    }
    toScopeMeta(scope) {
        return {
            type: scope.type,
            roles: scope.roles,
            union_id: scope.unionId ?? null,
            local_field_id: scope.localFieldId ?? null,
        };
    }
    extractRoleNames(assignments) {
        return [...new Set(assignments.map((item) => item.roles.role_name))];
    }
    async toListItem(user) {
        const roles = this.extractRoleNames(user.users_roles).sort((a, b) => a.localeCompare(b));
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
            user_image: await this.resolvePrivateProfileUrl(user.user_image),
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
    async resolvePrivateProfileUrl(value) {
        if (!value)
            return null;
        try {
            return await this.fileStorage.getSignedDownloadUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, value, {
                expiresInSeconds: AdminUsersService_1.PRIVATE_ASSET_URL_TTL_SECONDS,
            });
        }
        catch (error) {
            this.logger.warn('Failed to generate signed URL for admin user profile. Returning original value.', error);
            return value;
        }
    }
    resolveClubAssignment(assignment) {
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
};
exports.AdminUsersService = AdminUsersService;
exports.AdminUsersService = AdminUsersService = AdminUsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(file_storage_service_1.FILE_STORAGE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        authorization_context_service_1.AuthorizationContextService, Object])
], AdminUsersService);
//# sourceMappingURL=admin-users.service.js.map