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
var UsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const file_storage_service_1 = require("../common/services/file-storage.service");
let UsersService = class UsersService {
    static { UsersService_1 = this; }
    prisma;
    fileStorage;
    logger = new common_1.Logger(UsersService_1.name);
    static PRIVATE_ASSET_URL_TTL_SECONDS = 300;
    constructor(prisma, fileStorage) {
        this.prisma = prisma;
        this.fileStorage = fileStorage;
    }
    async ensureUserExists(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        return user;
    }
    async validateGeographyReferences(updateUserDto, currentUser) {
        let selectedUnion = null;
        if (updateUserDto.country_id !== undefined) {
            const country = await this.prisma.countries.findFirst({
                where: { country_id: updateUserDto.country_id, active: true },
                select: { country_id: true },
            });
            if (!country) {
                throw new common_1.BadRequestException('País no válido o inactivo');
            }
        }
        if (updateUserDto.union_id !== undefined) {
            selectedUnion = await this.prisma.unions.findFirst({
                where: { union_id: updateUserDto.union_id, active: true },
                select: { union_id: true, country_id: true },
            });
            if (!selectedUnion) {
                throw new common_1.BadRequestException('Unión no válida o inactiva');
            }
        }
        if (updateUserDto.local_field_id !== undefined) {
            const localField = await this.prisma.local_fields.findFirst({
                where: { local_field_id: updateUserDto.local_field_id, active: true },
                select: { local_field_id: true },
            });
            if (!localField) {
                throw new common_1.BadRequestException('Campo local no válido o inactivo');
            }
        }
        const targetCountryId = updateUserDto.country_id ?? currentUser.country_id;
        const targetUnionId = updateUserDto.union_id ?? currentUser.union_id;
        if (targetCountryId !== null && targetUnionId !== null) {
            if (!selectedUnion || selectedUnion.union_id !== targetUnionId) {
                selectedUnion = await this.prisma.unions.findUnique({
                    where: { union_id: targetUnionId },
                    select: { union_id: true, country_id: true },
                });
            }
            if (!selectedUnion || selectedUnion.country_id !== targetCountryId) {
                throw new common_1.BadRequestException('La unión seleccionada no pertenece al país seleccionado');
            }
        }
        const targetLocalFieldId = updateUserDto.local_field_id ?? currentUser.local_field_id;
        if (targetLocalFieldId !== null && targetUnionId !== null) {
            const localField = await this.prisma.local_fields.findUnique({
                where: { local_field_id: targetLocalFieldId },
                select: { local_field_id: true, union_id: true },
            });
            if (!localField || localField.union_id !== targetUnionId) {
                throw new common_1.BadRequestException('El campo local seleccionado no pertenece a la unión seleccionada');
            }
        }
    }
    async validateAllergiesExist(allergyIds) {
        if (!allergyIds.length)
            return;
        const rows = await this.prisma.allergies.findMany({
            where: {
                allergy_id: { in: allergyIds },
                active: true,
            },
            select: { allergy_id: true },
        });
        const found = new Set(rows.map((row) => row.allergy_id));
        const invalid = allergyIds.filter((id) => !found.has(id));
        if (invalid.length > 0) {
            throw new common_1.BadRequestException(`Alergias inválidas o inactivas: ${invalid.join(', ')}`);
        }
    }
    async validateDiseasesExist(diseaseIds) {
        if (!diseaseIds.length)
            return;
        const rows = await this.prisma.diseases.findMany({
            where: {
                disease_id: { in: diseaseIds },
                active: true,
            },
            select: { disease_id: true },
        });
        const found = new Set(rows.map((row) => row.disease_id));
        const invalid = diseaseIds.filter((id) => !found.has(id));
        if (invalid.length > 0) {
            throw new common_1.BadRequestException(`Enfermedades inválidas o inactivas: ${invalid.join(', ')}`);
        }
    }
    async findOne(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            select: {
                user_id: true,
                email: true,
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
                gender: true,
                birthday: true,
                baptism: true,
                baptism_date: true,
                blood: true,
                user_image: true,
                country_id: true,
                union_id: true,
                local_field_id: true,
                access_app: true,
                access_panel: true,
                created_at: true,
                modified_at: true,
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        if (user.user_image) {
            user.user_image = await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, user.user_image);
        }
        return { status: 'success', data: user };
    }
    async update(userId, updateUserDto) {
        const existingUser = await this.ensureUserExists(userId);
        if (updateUserDto.baptism === false && updateUserDto.baptism_date) {
            throw new common_1.BadRequestException('No se puede especificar fecha de bautismo si no está bautizado');
        }
        await this.validateGeographyReferences(updateUserDto, existingUser);
        const updatedUser = await this.prisma.users.update({
            where: { user_id: userId },
            data: updateUserDto,
            select: {
                user_id: true,
                email: true,
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
                gender: true,
                birthday: true,
                baptism: true,
                baptism_date: true,
                blood: true,
                country_id: true,
                union_id: true,
                local_field_id: true,
                modified_at: true,
            },
        });
        this.logger.log(`User updated: ${userId}`);
        return {
            status: 'success',
            data: updatedUser,
            message: 'Usuario actualizado exitosamente',
        };
    }
    async updateAllergies(userId, dto) {
        await this.ensureUserExists(userId);
        const allergyIds = [...new Set(dto.allergy_ids)];
        await this.validateAllergiesExist(allergyIds);
        const data = await this.prisma.$transaction(async (tx) => {
            const now = new Date();
            await tx.users_allergies.updateMany({
                where: {
                    user_id: userId,
                    active: true,
                    ...(allergyIds.length > 0
                        ? { allergy_id: { notIn: allergyIds } }
                        : {}),
                },
                data: {
                    active: false,
                    modified_at: now,
                },
            });
            for (const allergyId of allergyIds) {
                const existing = await tx.users_allergies.findFirst({
                    where: {
                        user_id: userId,
                        allergy_id: allergyId,
                    },
                    select: { user_allergies_id: true },
                });
                if (existing) {
                    await tx.users_allergies.update({
                        where: { user_allergies_id: existing.user_allergies_id },
                        data: {
                            active: true,
                            modified_at: now,
                        },
                    });
                }
                else {
                    await tx.users_allergies.create({
                        data: {
                            user_id: userId,
                            allergy_id: allergyId,
                            active: true,
                        },
                    });
                }
            }
            return tx.users_allergies.findMany({
                where: {
                    user_id: userId,
                    active: true,
                },
                select: {
                    allergy_id: true,
                    allergies: {
                        select: {
                            name: true,
                            description: true,
                        },
                    },
                },
                orderBy: { allergy_id: 'asc' },
            });
        });
        this.logger.log(`User allergies updated: ${userId}`);
        return {
            status: 'success',
            data,
            message: 'Alergias actualizadas exitosamente',
        };
    }
    async updateDiseases(userId, dto) {
        await this.ensureUserExists(userId);
        const diseaseIds = [...new Set(dto.disease_ids)];
        await this.validateDiseasesExist(diseaseIds);
        const data = await this.prisma.$transaction(async (tx) => {
            const now = new Date();
            await tx.users_diseases.updateMany({
                where: {
                    user_id: userId,
                    active: true,
                    ...(diseaseIds.length > 0
                        ? { disease_id: { notIn: diseaseIds } }
                        : {}),
                },
                data: {
                    active: false,
                    modified_at: now,
                },
            });
            for (const diseaseId of diseaseIds) {
                const existing = await tx.users_diseases.findFirst({
                    where: {
                        user_id: userId,
                        disease_id: diseaseId,
                    },
                    select: { user_disease_id: true },
                });
                if (existing) {
                    await tx.users_diseases.update({
                        where: { user_disease_id: existing.user_disease_id },
                        data: {
                            active: true,
                            modified_at: now,
                        },
                    });
                }
                else {
                    await tx.users_diseases.create({
                        data: {
                            user_id: userId,
                            disease_id: diseaseId,
                            active: true,
                        },
                    });
                }
            }
            return tx.users_diseases.findMany({
                where: {
                    user_id: userId,
                    active: true,
                },
                select: {
                    disease_id: true,
                    diseases: {
                        select: {
                            name: true,
                            description: true,
                        },
                    },
                },
                orderBy: { disease_id: 'asc' },
            });
        });
        this.logger.log(`User diseases updated: ${userId}`);
        return {
            status: 'success',
            data,
            message: 'Enfermedades actualizadas exitosamente',
        };
    }
    async removeAllergy(userId, allergyId) {
        await this.ensureUserExists(userId);
        const now = new Date();
        const result = await this.prisma.users_allergies.updateMany({
            where: {
                user_id: userId,
                allergy_id: allergyId,
                active: true,
            },
            data: {
                active: false,
                modified_at: now,
            },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException('Alergia no encontrada en el perfil del usuario');
        }
        this.logger.log(`User allergy removed: ${userId} -> ${allergyId}`);
        return {
            status: 'success',
            data: {
                allergy_id: allergyId,
                active: false,
            },
            message: 'Alergia eliminada exitosamente',
        };
    }
    async removeDisease(userId, diseaseId) {
        await this.ensureUserExists(userId);
        const now = new Date();
        const result = await this.prisma.users_diseases.updateMany({
            where: {
                user_id: userId,
                disease_id: diseaseId,
                active: true,
            },
            data: {
                active: false,
                modified_at: now,
            },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException('Enfermedad no encontrada en el perfil del usuario');
        }
        this.logger.log(`User disease removed: ${userId} -> ${diseaseId}`);
        return {
            status: 'success',
            data: {
                disease_id: diseaseId,
                active: false,
            },
            message: 'Enfermedad eliminada exitosamente',
        };
    }
    async uploadProfilePicture(userId, file) {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Formato no válido. Solo se permiten JPG, PNG, WEBP');
        }
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new common_1.BadRequestException('Archivo muy grande. Tamaño máximo: 5MB');
        }
        const extension = file.mimetype.split('/')[1];
        const fileName = `photo-${userId}-${Date.now()}.${extension}`;
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            select: { user_image: true },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        let uploaded;
        try {
            uploaded = await this.fileStorage.upload(file_storage_service_1.StorageBucketAlias.USER_PROFILES, fileName, file.buffer, {
                contentType: file.mimetype,
            });
        }
        catch (error) {
            this.logger.error('R2 upload error:', error);
            throw new common_1.InternalServerErrorException('Error al subir la imagen');
        }
        try {
            await this.prisma.users.update({
                where: { user_id: userId },
                data: { user_image: uploaded.url },
            });
        }
        catch (error) {
            this.logger.error('Database update failed after upload:', error);
            await this.rollbackUploadedObjects(file_storage_service_1.StorageBucketAlias.USER_PROFILES, [
                uploaded.key,
            ]);
            throw new common_1.InternalServerErrorException('Error al actualizar la imagen');
        }
        await this.cleanupPreviousProfilePicture(user.user_image, uploaded.key);
        this.logger.log(`Profile picture uploaded for user: ${userId}`);
        return {
            status: 'success',
            data: {
                url: await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, uploaded.url),
                fileName,
            },
            message: 'Foto de perfil actualizada exitosamente',
        };
    }
    async deleteProfilePicture(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            select: { user_image: true },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        if (!user.user_image) {
            throw new common_1.BadRequestException('El usuario no tiene foto de perfil');
        }
        const fileKey = this.fileStorage.extractKeyFromPublicUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, user.user_image);
        const previousUrl = user.user_image;
        try {
            await this.prisma.users.update({
                where: { user_id: userId },
                data: { user_image: null },
            });
        }
        catch (error) {
            this.logger.error('Database update failed while deleting profile image:', error);
            throw new common_1.InternalServerErrorException('Error al eliminar la imagen');
        }
        if (fileKey) {
            try {
                await this.fileStorage.deleteMany(file_storage_service_1.StorageBucketAlias.USER_PROFILES, [
                    fileKey,
                ]);
            }
            catch (error) {
                this.logger.error('R2 delete error:', error);
                try {
                    await this.prisma.users.update({
                        where: { user_id: userId },
                        data: { user_image: previousUrl },
                    });
                }
                catch (restoreError) {
                    this.logger.error('Critical: failed to restore DB after R2 delete error', restoreError);
                }
                throw new common_1.InternalServerErrorException('Error al eliminar la imagen');
            }
        }
        else {
            this.logger.warn(`Skipping remote delete for legacy/non-R2 URL: ${user.user_image}`);
        }
        this.logger.log(`Profile picture deleted for user: ${userId}`);
        return {
            status: 'success',
            message: 'Foto de perfil eliminada exitosamente',
        };
    }
    async calculateAge(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            select: { birthday: true },
        });
        if (!user || !user.birthday) {
            return null;
        }
        const today = new Date();
        const birthDate = new Date(user.birthday);
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }
    async requiresLegalRepresentative(userId) {
        const age = await this.calculateAge(userId);
        return age !== null && age < 18;
    }
    async rollbackUploadedObjects(bucketAlias, keys) {
        if (keys.length === 0)
            return;
        try {
            await this.fileStorage.deleteMany(bucketAlias, keys);
        }
        catch (error) {
            this.logger.error(`Critical: failed to rollback uploaded objects in ${bucketAlias}`, error);
        }
    }
    async cleanupPreviousProfilePicture(previousUrl, newKey) {
        if (!previousUrl)
            return;
        const previousKey = this.fileStorage.extractKeyFromPublicUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, previousUrl);
        if (!previousKey || previousKey === newKey)
            return;
        try {
            await this.fileStorage.deleteMany(file_storage_service_1.StorageBucketAlias.USER_PROFILES, [
                previousKey,
            ]);
        }
        catch (error) {
            this.logger.warn(`Best-effort cleanup failed for old profile picture: ${previousKey}`, error);
        }
    }
    async resolvePrivateAssetUrl(bucketAlias, value) {
        if (!value)
            return null;
        try {
            return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
                expiresInSeconds: UsersService_1.PRIVATE_ASSET_URL_TTL_SECONDS,
            });
        }
        catch (error) {
            this.logger.warn(`Failed to generate signed URL for ${bucketAlias}. Returning original value.`, error);
            return value;
        }
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = UsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(file_storage_service_1.FILE_STORAGE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], UsersService);
//# sourceMappingURL=users.service.js.map