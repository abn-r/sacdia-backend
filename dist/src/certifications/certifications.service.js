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
exports.CertificationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const pagination_dto_1 = require("../common/dto/pagination.dto");
let CertificationsService = class CertificationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(pagination) {
        const where = { active: true };
        const [certifications, total] = await Promise.all([
            this.prisma.certifications.findMany({
                where,
                include: {
                    _count: {
                        select: {
                            certification_modules: true,
                        },
                    },
                },
                orderBy: { certification_id: 'asc' },
                skip: pagination?.skip ?? 0,
                take: pagination?.take ?? 50,
            }),
            this.prisma.certifications.count({ where }),
        ]);
        const data = certifications.map((cert) => ({
            certification_id: cert.certification_id,
            name: cert.name,
            description: cert.description,
            active: cert.active,
            modules_count: cert._count.certification_modules,
        }));
        return (0, pagination_dto_1.createPaginatedResult)(data, total, pagination ?? new pagination_dto_1.PaginationDto());
    }
    async findOne(certificationId) {
        const certification = await this.prisma.certifications.findUnique({
            where: { certification_id: certificationId },
            include: {
                certification_modules: {
                    include: {
                        certification_sections: {
                            orderBy: { section_id: 'asc' },
                        },
                    },
                    orderBy: { module_id: 'asc' },
                },
            },
        });
        if (!certification) {
            throw new common_1.NotFoundException(`Certification with ID ${certificationId} not found`);
        }
        return {
            certification_id: certification.certification_id,
            name: certification.name,
            description: certification.description,
            active: certification.active,
            modules: certification.certification_modules.map((module) => ({
                module_id: module.module_id,
                name: module.name,
                description: module.description,
                sections: module.certification_sections.map((section) => ({
                    section_id: section.section_id,
                    name: section.name,
                    description: section.description,
                })),
            })),
        };
    }
    async enrollUser(userId, dto) {
        await this.validateEligibility(userId);
        const certification = await this.prisma.certifications.findUnique({
            where: { certification_id: dto.certification_id },
        });
        if (!certification || !certification.active) {
            throw new common_1.NotFoundException('Certification not found');
        }
        const existingEnrollment = await this.prisma.users_certifications.findFirst({
            where: {
                user_id: userId,
                certification_id: dto.certification_id,
                active: true,
            },
        });
        if (existingEnrollment) {
            throw new common_1.ConflictException('User already enrolled in this certification');
        }
        const enrollment = await this.prisma.users_certifications.create({
            data: {
                user_id: userId,
                certification_id: dto.certification_id,
                enrollment_date: new Date(),
                completion_status: false,
                active: true,
            },
            include: {
                certifications: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        return {
            enrollment_id: enrollment.enrollment_id,
            user_id: enrollment.user_id,
            certification_id: enrollment.certification_id,
            enrollment_date: enrollment.enrollment_date,
            completion_status: enrollment.completion_status,
            completion_date: enrollment.completion_date,
            active: enrollment.active,
            certification: {
                name: enrollment.certifications.name,
            },
        };
    }
    async validateEligibility(userId) {
        const enrollment = await this.prisma.enrollments.findFirst({
            where: {
                user_id: userId,
                investiture_status: 'INVESTIDO',
                classes: {
                    name: 'Guía Mayor',
                },
            },
            include: {
                classes: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        if (!enrollment) {
            throw new common_1.ForbiddenException('Only invested Guías Mayores can enroll in certifications');
        }
        return true;
    }
    async getUserCertifications(userId) {
        const enrollments = await this.prisma.users_certifications.findMany({
            where: {
                user_id: userId,
                active: true,
            },
            include: {
                certifications: {
                    select: {
                        name: true,
                        certification_modules: {
                            select: {
                                module_id: true,
                            },
                        },
                    },
                },
            },
            orderBy: { enrollment_date: 'desc' },
        });
        return Promise.all(enrollments.map(async (enrollment) => {
            const modulesTotal = enrollment.certifications.certification_modules.length;
            const completedModules = await this.prisma.certification_module_progress.count({
                where: {
                    user_id: userId,
                    module_id: {
                        in: enrollment.certifications.certification_modules.map((m) => m.module_id),
                    },
                    completed: true,
                },
            });
            const progressPercentage = modulesTotal > 0 ? (completedModules / modulesTotal) * 100 : 0;
            return {
                enrollment_id: enrollment.enrollment_id,
                certification_id: enrollment.certification_id,
                certification: {
                    name: enrollment.certifications.name,
                },
                enrollment_date: enrollment.enrollment_date,
                completion_status: enrollment.completion_status,
                progress_percentage: Math.round(progressPercentage * 10) / 10,
                modules_completed: completedModules,
                modules_total: modulesTotal,
                active: enrollment.active,
            };
        }));
    }
    async getCertificationProgress(userId, certificationId) {
        const enrollment = await this.prisma.users_certifications.findFirst({
            where: {
                user_id: userId,
                certification_id: certificationId,
                active: true,
            },
            include: {
                certifications: {
                    select: {
                        name: true,
                        certification_modules: {
                            include: {
                                certification_sections: {
                                    orderBy: { section_id: 'asc' },
                                },
                            },
                            orderBy: { module_id: 'asc' },
                        },
                    },
                },
            },
        });
        if (!enrollment) {
            throw new common_1.NotFoundException('Certification enrollment not found');
        }
        const moduleProgress = await this.prisma.certification_module_progress.findMany({
            where: {
                user_id: userId,
                module_id: {
                    in: enrollment.certifications.certification_modules.map((m) => m.module_id),
                },
            },
        });
        const sectionIds = enrollment.certifications.certification_modules.flatMap((m) => m.certification_sections.map((s) => s.section_id));
        const sectionProgress = await this.prisma.certification_section_progress.findMany({
            where: {
                user_id: userId,
                section_id: { in: sectionIds },
            },
        });
        const modules = enrollment.certifications.certification_modules.map((module) => {
            const moduleProgressData = moduleProgress.find((mp) => mp.module_id === module.module_id);
            const sections = module.certification_sections.map((section) => {
                const sectionProgressData = sectionProgress.find((sp) => sp.section_id === section.section_id);
                return {
                    section_id: section.section_id,
                    name: section.name,
                    completed: sectionProgressData?.completed ?? false,
                    completion_date: sectionProgressData?.completion_date ?? null,
                };
            });
            return {
                module_id: module.module_id,
                name: module.name,
                completed: moduleProgressData?.completed ?? false,
                completion_date: moduleProgressData?.completion_date ?? null,
                sections,
            };
        });
        const modulesCompleted = modules.filter((m) => m.completed).length;
        const modulesTotal = modules.length;
        const progressPercentage = modulesTotal > 0 ? (modulesCompleted / modulesTotal) * 100 : 0;
        return {
            enrollment_id: enrollment.enrollment_id,
            certification_id: enrollment.certification_id,
            certification_name: enrollment.certifications.name,
            progress_percentage: Math.round(progressPercentage * 10) / 10,
            completion_status: enrollment.completion_status,
            enrollment_date: enrollment.enrollment_date,
            modules,
        };
    }
    async updateProgress(userId, certificationId, dto) {
        return await this.prisma.$transaction(async (tx) => {
            const enrollment = await tx.users_certifications.findFirst({
                where: {
                    user_id: userId,
                    certification_id: certificationId,
                    active: true,
                },
            });
            if (!enrollment) {
                throw new common_1.NotFoundException('Certification enrollment not found');
            }
            const section = await tx.certification_sections.findFirst({
                where: {
                    section_id: dto.section_id,
                    module_id: dto.module_id,
                    certification_modules: {
                        certification_id: certificationId,
                    },
                },
            });
            if (!section) {
                throw new common_1.BadRequestException('Invalid module or section for this certification');
            }
            const sectionProgressExists = await tx.certification_section_progress.findFirst({
                where: {
                    user_id: userId,
                    section_id: dto.section_id,
                },
            });
            let sectionProgress;
            if (sectionProgressExists) {
                sectionProgress = await tx.certification_section_progress.update({
                    where: { progress_id: sectionProgressExists.progress_id },
                    data: {
                        completed: dto.completed,
                        completion_date: dto.completed ? new Date() : null,
                    },
                });
            }
            else {
                sectionProgress = await tx.certification_section_progress.create({
                    data: {
                        user_id: userId,
                        section_id: dto.section_id,
                        module_id: dto.module_id,
                        certification_id: certificationId,
                        score: 0,
                        completed: dto.completed,
                        completion_date: dto.completed ? new Date() : null,
                    },
                });
            }
            const allSectionsInModule = await tx.certification_sections.findMany({
                where: { module_id: dto.module_id },
            });
            const completedSectionsCount = await tx.certification_section_progress.count({
                where: {
                    user_id: userId,
                    section_id: { in: allSectionsInModule.map((s) => s.section_id) },
                    completed: true,
                },
            });
            const moduleCompleted = completedSectionsCount === allSectionsInModule.length;
            const moduleProgressExists = await tx.certification_module_progress.findFirst({
                where: {
                    user_id: userId,
                    module_id: dto.module_id,
                },
            });
            let moduleProgress;
            if (moduleProgressExists) {
                moduleProgress = await tx.certification_module_progress.update({
                    where: { progress_id: moduleProgressExists.progress_id },
                    data: {
                        completed: moduleCompleted,
                        completion_date: moduleCompleted ? new Date() : null,
                    },
                });
            }
            else {
                moduleProgress = await tx.certification_module_progress.create({
                    data: {
                        user_id: userId,
                        module_id: dto.module_id,
                        certification_id: certificationId,
                        score: 0,
                        completed: moduleCompleted,
                        completion_date: moduleCompleted ? new Date() : null,
                    },
                });
            }
            const allModulesInCertification = await tx.certification_modules.findMany({
                where: { certification_id: certificationId },
            });
            const completedModulesCount = await tx.certification_module_progress.count({
                where: {
                    user_id: userId,
                    module_id: {
                        in: allModulesInCertification.map((m) => m.module_id),
                    },
                    completed: true,
                },
            });
            const certificationCompleted = completedModulesCount === allModulesInCertification.length;
            if (certificationCompleted) {
                await tx.users_certifications.update({
                    where: { enrollment_id: enrollment.enrollment_id },
                    data: {
                        completion_status: true,
                        completion_date: new Date(),
                    },
                });
            }
            const progressPercentage = allModulesInCertification.length > 0
                ? (completedModulesCount / allModulesInCertification.length) * 100
                : 0;
            return {
                section_progress_id: sectionProgress.progress_id,
                module_id: dto.module_id,
                section_id: dto.section_id,
                completed: sectionProgress.completed,
                completion_date: sectionProgress.completion_date,
                module_progress: {
                    module_id: moduleProgress.module_id,
                    completed: moduleProgress.completed,
                    completion_date: moduleProgress.completion_date,
                },
                certification_progress: {
                    progress_percentage: Math.round(progressPercentage * 10) / 10,
                    completion_status: certificationCompleted,
                },
            };
        });
    }
    async deleteCertification(userId, certificationId) {
        const enrollment = await this.prisma.users_certifications.findFirst({
            where: {
                user_id: userId,
                certification_id: certificationId,
                active: true,
            },
        });
        if (!enrollment) {
            throw new common_1.NotFoundException('Certification enrollment not found');
        }
        await this.prisma.users_certifications.update({
            where: { enrollment_id: enrollment.enrollment_id },
            data: {
                active: false,
            },
        });
        return {
            message: 'Certification enrollment deleted successfully',
        };
    }
};
exports.CertificationsService = CertificationsService;
exports.CertificationsService = CertificationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CertificationsService);
//# sourceMappingURL=certifications.service.js.map