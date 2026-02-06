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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoldersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const pagination_dto_1 = require("../common/dto/pagination.dto");
let FoldersService = class FoldersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(clubTypeId, pagination) {
        const where = {
            active: true,
            ...(clubTypeId && { club_type: clubTypeId }),
        };
        const [data, total] = await Promise.all([
            this.prisma.folders.findMany({
                where,
                select: {
                    folder_id: true,
                    name: true,
                    description: true,
                    club_type: true,
                    ecclesiastical_year_id: true,
                    max_points: true,
                    minimum_points: true,
                    active: true,
                    _count: {
                        select: {
                            folders_modules: true,
                        },
                    },
                },
                orderBy: { folder_id: 'asc' },
                skip: pagination?.skip ?? 0,
                take: pagination?.take ?? 50,
            }),
            this.prisma.folders.count({ where }),
        ]);
        const transformedData = data.map((folder) => ({
            ...folder,
            modules_count: folder._count.folders_modules,
            _count: undefined,
        }));
        return (0, pagination_dto_1.createPaginatedResult)(transformedData, total, pagination ?? new pagination_dto_1.PaginationDto());
    }
    async findOne(folderId) {
        const folder = await this.prisma.folders.findUnique({
            where: { folder_id: folderId },
            include: {
                folders_modules: {
                    include: {
                        folders_sections: {
                            orderBy: { folder_section_id: 'asc' },
                        },
                    },
                    orderBy: { folder_module_id: 'asc' },
                },
            },
        });
        if (!folder) {
            throw new common_1.NotFoundException(`Folder with ID ${folderId} not found`);
        }
        return {
            folder_id: folder.folder_id,
            name: folder.name,
            description: folder.description,
            club_type: folder.club_type,
            ecclesiastical_year_id: folder.ecclesiastical_year_id,
            max_points: folder.max_points,
            minimum_points: folder.minimum_points,
            active: folder.active,
            modules: folder.folders_modules.map((module) => ({
                module_id: module.folder_module_id,
                name: module.name,
                description: module.description,
                max_points: module.max_points,
                minimum_points: module.minimum_points,
                sections: module.folders_sections.map((section) => ({
                    section_id: section.folder_section_id,
                    name: section.name,
                    description: section.description,
                    max_points: section.max_points,
                    minimum_points: section.minimum_points,
                })),
            })),
        };
    }
    async enrollUser(userId, folderId) {
        const folder = await this.prisma.folders.findUnique({
            where: { folder_id: folderId },
        });
        if (!folder || !folder.active) {
            throw new common_1.NotFoundException('Folder not found');
        }
        const existingAssignment = await this.prisma.folder_assignments.findFirst({
            where: {
                user_id: userId,
                folder_id: folderId,
                active: true,
            },
        });
        if (existingAssignment) {
            throw new common_1.ConflictException('User already has an active assignment for this folder');
        }
        const clubInstances = await this.getUserClubInstances(userId);
        let clubAdvId = null;
        let clubPathfId = null;
        let clubMgId = null;
        if (folder.club_type === 1) {
            clubAdvId = clubInstances.adventurers;
        }
        else if (folder.club_type === 2) {
            clubPathfId = clubInstances.pathfinders;
        }
        else if (folder.club_type === 3) {
            clubMgId = clubInstances.masterGuilds;
        }
        if (!clubAdvId && !clubPathfId && !clubMgId) {
            throw new common_1.BadRequestException(`User does not belong to a club of the required type`);
        }
        const assignment = await this.prisma.folder_assignments.create({
            data: {
                folder_id: folderId,
                user_id: userId,
                club_adv_id: clubAdvId,
                club_pathf_id: clubPathfId,
                club_mg_id: clubMgId,
                assignment_date: new Date(),
                status: 'IN_PROGRESS',
                total_points: 0,
                progress_percentage: 0,
                active: true,
            },
        });
        return assignment;
    }
    async getUserClubInstances(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            include: {
                club_role_assignments: true,
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const clubAssignments = user.club_role_assignments;
        return {
            adventurers: clubAssignments.find((ca) => ca.club_adv_id)?.club_adv_id ?? null,
            pathfinders: clubAssignments.find((ca) => ca.club_pathf_id)?.club_pathf_id ?? null,
            masterGuilds: clubAssignments.find((ca) => ca.club_mg_id)?.club_mg_id ?? null,
        };
    }
    async getUserFolders(userId) {
        const assignments = await this.prisma.folder_assignments.findMany({
            where: {
                user_id: userId,
                active: true,
            },
            include: {
                folders: {
                    select: {
                        name: true,
                        description: true,
                        max_points: true,
                        minimum_points: true,
                    },
                },
            },
            orderBy: { assignment_date: 'desc' },
        });
        return assignments.map((assignment) => ({
            assignment_id: assignment.folder_assignment_id,
            folder_id: assignment.folder_id,
            folder: {
                name: assignment.folders?.name,
                description: assignment.folders?.description,
                max_points: assignment.folders?.max_points,
                minimum_points: assignment.folders?.minimum_points,
            },
            status: assignment.status,
            total_points: assignment.total_points,
            progress_percentage: assignment.progress_percentage,
            assigned_date: assignment.assignment_date,
            completion_date: assignment.completion_date,
            active: assignment.active,
        }));
    }
    async getFolderProgress(userId, folderId) {
        const assignment = await this.prisma.folder_assignments.findFirst({
            where: {
                user_id: userId,
                folder_id: folderId,
                active: true,
            },
            include: {
                folders: {
                    include: {
                        folders_modules: {
                            include: {
                                folders_sections: {
                                    orderBy: { folder_section_id: 'asc' },
                                },
                            },
                            orderBy: { folder_module_id: 'asc' },
                        },
                    },
                },
            },
        });
        if (!assignment) {
            throw new common_1.NotFoundException('Folder assignment not found');
        }
        const moduleRecords = await this.prisma.folders_modules_records.findMany({
            where: {
                folder_id: folderId,
                OR: [
                    { club_adv_id: assignment.club_adv_id },
                    { club_pathf_id: assignment.club_pathf_id },
                    { club_mg_id: assignment.club_mg_id },
                ],
            },
        });
        const sectionRecords = await this.prisma.folders_section_records.findMany({
            where: {
                folder_id: folderId,
                OR: [
                    { club_adv_id: assignment.club_adv_id },
                    { club_pathf_id: assignment.club_pathf_id },
                    { club_mg_id: assignment.club_mg_id },
                ],
            },
        });
        const modules = assignment.folders?.folders_modules.map((module) => {
            const moduleRecord = moduleRecords.find((mr) => mr.module_id === module.folder_module_id);
            const sections = module.folders_sections.map((section) => {
                const sectionRecord = sectionRecords.find((sr) => sr.section_id === section.folder_section_id);
                return {
                    section_id: section.folder_section_id,
                    name: section.name,
                    max_points: section.max_points,
                    earned_points: sectionRecord?.points ?? 0,
                    evidences: sectionRecord?.evidences ?? null,
                };
            });
            const earnedPoints = sections.reduce((sum, s) => sum + (s.earned_points ?? 0), 0);
            const maxPoints = module.max_points ?? 0;
            const progressPercentage = maxPoints > 0 ? (earnedPoints / maxPoints) * 100 : 0;
            return {
                module_id: module.folder_module_id,
                name: module.name,
                max_points: module.max_points,
                earned_points: earnedPoints,
                progress_percentage: Math.round(progressPercentage * 10) / 10,
                sections,
            };
        }) ?? [];
        return {
            folder_id: assignment.folder_id,
            folder_name: assignment.folders?.name,
            status: assignment.status,
            progress_percentage: assignment.progress_percentage,
            total_points: assignment.total_points,
            max_points: assignment.folders?.max_points,
            minimum_points: assignment.folders?.minimum_points,
            assigned_date: assignment.assignment_date,
            completion_date: assignment.completion_date,
            modules,
        };
    }
    async updateSectionProgress(userId, folderId, moduleId, sectionId, dto) {
        return await this.prisma.$transaction(async (tx) => {
            const assignment = await tx.folder_assignments.findFirst({
                where: {
                    user_id: userId,
                    folder_id: folderId,
                    active: true,
                },
                include: {
                    folders: true,
                },
            });
            if (!assignment) {
                throw new common_1.NotFoundException('Folder assignment not found');
            }
            const section = await tx.folders_sections.findFirst({
                where: {
                    folder_section_id: sectionId,
                    module_id: moduleId,
                    folders_modules: {
                        folder_id: folderId,
                    },
                },
            });
            if (!section) {
                throw new common_1.BadRequestException('Invalid module or section for this folder');
            }
            const sectionMaxPoints = section.max_points ?? 0;
            if (dto.points > sectionMaxPoints) {
                throw new common_1.BadRequestException('Points exceed section maximum');
            }
            const existingRecord = await tx.folders_section_records.findFirst({
                where: {
                    folder_id: folderId,
                    section_id: sectionId,
                    OR: [
                        { club_adv_id: assignment.club_adv_id },
                        { club_pathf_id: assignment.club_pathf_id },
                        { club_mg_id: assignment.club_mg_id },
                    ],
                },
            });
            let sectionRecord;
            if (existingRecord) {
                sectionRecord = await tx.folders_section_records.update({
                    where: {
                        folder_section_record_id: existingRecord.folder_section_record_id,
                    },
                    data: {
                        points: dto.points,
                        evidences: dto.evidences,
                    },
                });
            }
            else {
                sectionRecord = await tx.folders_section_records.create({
                    data: {
                        folder_id: folderId,
                        module_id: moduleId,
                        section_id: sectionId,
                        points: dto.points,
                        evidences: dto.evidences,
                        club_adv_id: assignment.club_adv_id,
                        club_pathf_id: assignment.club_pathf_id,
                        club_mg_id: assignment.club_mg_id,
                    },
                });
            }
            const allSectionsInModule = await tx.folders_sections.findMany({
                where: { module_id: moduleId },
            });
            const moduleSectionRecords = await tx.folders_section_records.findMany({
                where: {
                    folder_id: folderId,
                    module_id: moduleId,
                    OR: [
                        { club_adv_id: assignment.club_adv_id },
                        { club_pathf_id: assignment.club_pathf_id },
                        { club_mg_id: assignment.club_mg_id },
                    ],
                },
            });
            const modulePoints = moduleSectionRecords.reduce((sum, record) => sum + (record.points ?? 0), 0);
            const existingModuleRecord = await tx.folders_modules_records.findFirst({
                where: {
                    folder_id: folderId,
                    module_id: moduleId,
                    OR: [
                        { club_adv_id: assignment.club_adv_id },
                        { club_pathf_id: assignment.club_pathf_id },
                        { club_mg_id: assignment.club_mg_id },
                    ],
                },
            });
            if (existingModuleRecord) {
                await tx.folders_modules_records.update({
                    where: {
                        folder_module_record_id: existingModuleRecord.folder_module_record_id,
                    },
                    data: { points: modulePoints },
                });
            }
            else {
                await tx.folders_modules_records.create({
                    data: {
                        folder_id: folderId,
                        module_id: moduleId,
                        points: modulePoints,
                        club_adv_id: assignment.club_adv_id,
                        club_pathf_id: assignment.club_pathf_id,
                        club_mg_id: assignment.club_mg_id,
                    },
                });
            }
            const allFolderSectionRecords = await tx.folders_section_records.findMany({
                where: {
                    folder_id: folderId,
                    OR: [
                        { club_adv_id: assignment.club_adv_id },
                        { club_pathf_id: assignment.club_pathf_id },
                        { club_mg_id: assignment.club_mg_id },
                    ],
                },
            });
            const totalPoints = allFolderSectionRecords.reduce((sum, record) => sum + (record.points ?? 0), 0);
            const maxPoints = assignment.folders?.max_points ?? 0;
            const minimumPoints = assignment.folders?.minimum_points ?? 0;
            const progressPercentage = maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;
            const folderCompleted = totalPoints >= minimumPoints;
            await tx.folder_assignments.update({
                where: { folder_assignment_id: assignment.folder_assignment_id },
                data: {
                    total_points: totalPoints,
                    progress_percentage: Math.round(progressPercentage * 10) / 10,
                    status: folderCompleted ? 'COMPLETED' : 'IN_PROGRESS',
                    completion_date: folderCompleted ? new Date() : null,
                },
            });
            return {
                section_record_id: sectionRecord.folder_section_record_id,
                folder_id: folderId,
                module_id: moduleId,
                section_id: sectionId,
                points: sectionRecord.points,
                evidences: sectionRecord.evidences,
                folder_progress: {
                    total_points: totalPoints,
                    progress_percentage: Math.round(progressPercentage * 10) / 10,
                    status: folderCompleted ? 'COMPLETED' : 'IN_PROGRESS',
                },
            };
        });
    }
    async deleteAssignment(userId, folderId) {
        const assignment = await this.prisma.folder_assignments.findFirst({
            where: {
                user_id: userId,
                folder_id: folderId,
                active: true,
            },
        });
        if (!assignment) {
            throw new common_1.NotFoundException('Folder assignment not found');
        }
        await this.prisma.folder_assignments.update({
            where: { folder_assignment_id: assignment.folder_assignment_id },
            data: { active: false },
        });
        return {
            message: 'Folder assignment deleted successfully',
        };
    }
};
exports.FoldersService = FoldersService;
exports.FoldersService = FoldersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FoldersService);
//# sourceMappingURL=folders.service.js.map