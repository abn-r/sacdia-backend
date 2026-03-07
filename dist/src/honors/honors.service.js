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
var HonorsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HonorsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const pagination_dto_1 = require("../common/dto/pagination.dto");
const file_storage_service_1 = require("../common/services/file-storage.service");
let HonorsService = class HonorsService {
    static { HonorsService_1 = this; }
    prisma;
    fileStorage;
    logger = new common_1.Logger(HonorsService_1.name);
    static PRIVATE_ASSET_URL_TTL_SECONDS = 300;
    constructor(prisma, fileStorage) {
        this.prisma = prisma;
        this.fileStorage = fileStorage;
    }
    async findAll(filters, pagination) {
        const where = {
            active: true,
            ...(filters?.categoryId && { honors_category_id: filters.categoryId }),
            ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
            ...(filters?.skillLevel && { skill_level: filters.skillLevel }),
        };
        const [data, total] = await Promise.all([
            this.prisma.honors.findMany({
                where,
                include: {
                    honors_categories: { select: { name: true, icon: true } },
                    club_types: { select: { name: true } },
                },
                orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
                skip: pagination?.skip ?? 0,
                take: pagination?.take ?? 50,
            }),
            this.prisma.honors.count({ where }),
        ]);
        return (0, pagination_dto_1.createPaginatedResult)(data, total, pagination ?? new pagination_dto_1.PaginationDto());
    }
    async getGroupedByCategory(filters) {
        const where = {
            active: true,
            ...(filters?.categoryId && { honors_category_id: filters.categoryId }),
            ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
            ...(filters?.skillLevel && { skill_level: filters.skillLevel }),
        };
        const honors = await this.prisma.honors.findMany({
            where,
            select: {
                honor_id: true,
                name: true,
                description: true,
                honor_image: true,
                skill_level: true,
                club_type_id: true,
                honors_category_id: true,
                honors_categories: {
                    select: {
                        honor_category_id: true,
                        name: true,
                        description: true,
                        icon: true,
                    },
                },
                club_types: { select: { name: true } },
            },
            orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
        });
        const grouped = new Map();
        for (const honor of honors) {
            const category = honor.honors_categories;
            const key = category?.honor_category_id
                ? String(category.honor_category_id)
                : 'uncategorized';
            if (!grouped.has(key)) {
                grouped.set(key, {
                    category: category
                        ? {
                            honor_category_id: category.honor_category_id,
                            name: category.name,
                            description: category.description,
                            icon: category.icon,
                        }
                        : {
                            honor_category_id: null,
                            name: 'Sin categoría',
                            description: null,
                            icon: null,
                        },
                    honors: [],
                });
            }
            grouped.get(key).honors.push({
                honor_id: honor.honor_id,
                name: honor.name,
                description: honor.description,
                honor_image: honor.honor_image,
                skill_level: honor.skill_level,
                club_type_id: honor.club_type_id,
                club_type_name: honor.club_types?.name ?? null,
            });
        }
        return Array.from(grouped.values());
    }
    async findOne(honorId) {
        const honor = await this.prisma.honors.findUnique({
            where: { honor_id: honorId, active: true },
            include: {
                honors_categories: true,
                club_types: { select: { name: true } },
                master_honors: { select: { name: true } },
            },
        });
        if (!honor) {
            throw new common_1.NotFoundException(`Honor with ID ${honorId} not found`);
        }
        return honor;
    }
    async getCategories() {
        return this.prisma.honors_categories.findMany({
            where: { active: true },
            select: {
                honor_category_id: true,
                name: true,
                description: true,
                icon: true,
            },
            orderBy: { name: 'asc' },
        });
    }
    async getUserHonors(userId, validated) {
        const honors = await this.prisma.users_honors.findMany({
            where: {
                user_id: userId,
                active: true,
                ...(validated !== undefined && { validate: validated }),
            },
            include: {
                honors: {
                    select: {
                        honor_id: true,
                        name: true,
                        honor_image: true,
                        skill_level: true,
                        honors_categories: { select: { name: true, icon: true } },
                    },
                },
            },
            orderBy: { created_at: 'desc' },
        });
        return Promise.all(honors.map((userHonor) => this.mapUserHonorPrivateUrls(userHonor)));
    }
    async startHonor(userId, honorId, dto) {
        await this.findOne(honorId);
        const existing = await this.prisma.users_honors.findFirst({
            where: {
                user_id: userId,
                honor_id: honorId,
            },
        });
        if (existing && existing.active) {
            throw new common_1.ConflictException('User already has this honor in progress');
        }
        if (existing) {
            const updated = await this.prisma.users_honors.update({
                where: { user_honor_id: existing.user_honor_id },
                data: {
                    active: true,
                    date: dto?.date ? new Date(dto.date) : new Date(),
                    validate: false,
                    certificate: '',
                    images: [],
                    document: null,
                    modified_at: new Date(),
                },
                include: {
                    honors: {
                        select: {
                            name: true,
                            honor_image: true,
                            honors_categories: { select: { name: true } },
                        },
                    },
                },
            });
            return this.mapUserHonorPrivateUrls(updated);
        }
        const created = await this.prisma.users_honors.create({
            data: {
                user_id: userId,
                honor_id: honorId,
                date: dto?.date ? new Date(dto.date) : new Date(),
                validate: false,
                certificate: '',
                images: [],
                active: true,
            },
            include: {
                honors: {
                    select: {
                        name: true,
                        honor_image: true,
                        honors_categories: { select: { name: true } },
                    },
                },
            },
        });
        return this.mapUserHonorPrivateUrls(created);
    }
    async createUserHonor(userId, dto) {
        await this.findOne(dto.honorId);
        const existing = await this.prisma.users_honors.findFirst({
            where: {
                user_id: userId,
                honor_id: dto.honorId,
            },
            select: {
                user_honor_id: true,
            },
        });
        if (existing) {
            const updated = await this.prisma.users_honors.update({
                where: { user_honor_id: existing.user_honor_id },
                data: this.buildUpdateDataFromCreateDto(dto),
                include: {
                    honors: {
                        select: {
                            honor_id: true,
                            name: true,
                            honor_image: true,
                            honors_categories: { select: { name: true } },
                        },
                    },
                },
            });
            return this.mapUserHonorPrivateUrls(updated);
        }
        const created = await this.prisma.users_honors.create({
            data: {
                user_id: userId,
                honor_id: dto.honorId,
                ...this.buildCreateDataFromCreateDto(dto),
            },
            include: {
                honors: {
                    select: {
                        honor_id: true,
                        name: true,
                        honor_image: true,
                        honors_categories: { select: { name: true } },
                    },
                },
            },
        });
        return this.mapUserHonorPrivateUrls(created);
    }
    async createUserHonorsBulk(userId, dto) {
        const honorIds = dto.honors.map((item) => item.honorId);
        const seen = new Set();
        const duplicated = new Set();
        for (const honorId of honorIds) {
            if (seen.has(honorId))
                duplicated.add(honorId);
            seen.add(honorId);
        }
        if (duplicated.size > 0) {
            throw new common_1.BadRequestException(`Duplicate honorId values in payload: ${Array.from(duplicated).join(', ')}`);
        }
        const activeHonors = await this.prisma.honors.findMany({
            where: {
                honor_id: { in: honorIds },
                active: true,
            },
            select: { honor_id: true },
        });
        const activeHonorIds = new Set(activeHonors.map((item) => item.honor_id));
        const missingHonorIds = honorIds.filter((honorId) => !activeHonorIds.has(honorId));
        if (missingHonorIds.length > 0) {
            throw new common_1.NotFoundException(`Honors not found or inactive: ${missingHonorIds.join(', ')}`);
        }
        const existingUserHonors = await this.prisma.users_honors.findMany({
            where: {
                user_id: userId,
                honor_id: { in: honorIds },
            },
            select: {
                user_honor_id: true,
                honor_id: true,
            },
        });
        const existingByHonorId = new Map(existingUserHonors.map((item) => [item.honor_id, item.user_honor_id]));
        const operations = dto.honors.map((item) => {
            const existingId = existingByHonorId.get(item.honorId);
            if (existingId) {
                return this.prisma.users_honors.update({
                    where: { user_honor_id: existingId },
                    data: this.buildUpdateDataFromCreateDto(item),
                    include: {
                        honors: {
                            select: {
                                honor_id: true,
                                name: true,
                                honor_image: true,
                                honors_categories: { select: { name: true } },
                            },
                        },
                    },
                });
            }
            return this.prisma.users_honors.create({
                data: {
                    user_id: userId,
                    honor_id: item.honorId,
                    ...this.buildCreateDataFromCreateDto(item),
                },
                include: {
                    honors: {
                        select: {
                            honor_id: true,
                            name: true,
                            honor_image: true,
                            honors_categories: { select: { name: true } },
                        },
                    },
                },
            });
        });
        const createdOrUpdated = await Promise.all(operations);
        return Promise.all(createdOrUpdated.map((userHonor) => this.mapUserHonorPrivateUrls(userHonor)));
    }
    async uploadUserHonorFiles(userId, honorId, files) {
        const certificateFile = files.certificate?.[0];
        const documentFile = files.document?.[0];
        const imageFiles = files.images ?? [];
        if (!certificateFile && !documentFile && imageFiles.length === 0) {
            throw new common_1.BadRequestException('At least one file is required: certificate, document or images');
        }
        await this.findOne(honorId);
        if (certificateFile) {
            this.validateCertificateFile(certificateFile);
        }
        if (documentFile) {
            this.validateDocumentFile(documentFile);
        }
        for (const imageFile of imageFiles) {
            this.validateImageFile(imageFile);
        }
        const existingUserHonor = await this.prisma.users_honors.findFirst({
            where: {
                user_id: userId,
                honor_id: honorId,
            },
            select: {
                user_honor_id: true,
                date: true,
                validate: true,
                certificate: true,
                images: true,
                document: true,
            },
        });
        const currentImages = this.extractImageUrls(existingUserHonor?.images);
        let nextCertificateUrl = existingUserHonor?.certificate || '';
        let nextDocumentUrl = typeof existingUserHonor?.document === 'string'
            ? existingUserHonor.document
            : null;
        const previousCertificateUrl = existingUserHonor?.certificate || '';
        const previousDocumentUrl = typeof existingUserHonor?.document === 'string'
            ? existingUserHonor.document
            : null;
        const uploadedImageUrls = [];
        const uploadedObjects = [];
        try {
            if (certificateFile) {
                const certificateExtension = this.getFileExtension(certificateFile);
                const certificateName = `cert-${userId}-${honorId}-${Date.now()}.${certificateExtension}`;
                const uploadedCertificate = await this.fileStorage.upload(file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT, certificateName, certificateFile.buffer, {
                    contentType: certificateFile.mimetype,
                });
                uploadedObjects.push({
                    bucketAlias: file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT,
                    key: uploadedCertificate.key,
                });
                nextCertificateUrl = uploadedCertificate.url;
            }
            if (documentFile) {
                const documentExtension = this.getFileExtension(documentFile);
                const documentName = `doc-${userId}-${honorId}-${Date.now()}.${documentExtension}`;
                const uploadedDocument = await this.fileStorage.upload(file_storage_service_1.StorageBucketAlias.USERS_HONORS, documentName, documentFile.buffer, {
                    contentType: documentFile.mimetype,
                });
                uploadedObjects.push({
                    bucketAlias: file_storage_service_1.StorageBucketAlias.USERS_HONORS,
                    key: uploadedDocument.key,
                });
                nextDocumentUrl = uploadedDocument.url;
            }
            let imageIndex = currentImages.length + 1;
            for (const imageFile of imageFiles) {
                const extension = this.getFileExtension(imageFile);
                const imageName = `img-${userId}-${honorId}-img${imageIndex}.${extension}`;
                const uploadedImage = await this.fileStorage.upload(file_storage_service_1.StorageBucketAlias.USERS_HONORS, imageName, imageFile.buffer, {
                    contentType: imageFile.mimetype,
                    overwrite: false,
                });
                uploadedObjects.push({
                    bucketAlias: file_storage_service_1.StorageBucketAlias.USERS_HONORS,
                    key: uploadedImage.key,
                });
                uploadedImageUrls.push(uploadedImage.url);
                imageIndex += 1;
            }
        }
        catch (error) {
            await this.rollbackUploadedObjects(uploadedObjects);
            throw new common_1.InternalServerErrorException('Error al subir archivos del honor');
        }
        const finalImages = [...currentImages, ...uploadedImageUrls];
        let updated;
        try {
            updated = await this.prisma.$transaction((tx) => tx.users_honors.upsert({
                where: {
                    user_id_honor_id: {
                        user_id: userId,
                        honor_id: honorId,
                    },
                },
                update: {
                    active: true,
                    modified_at: new Date(),
                    ...(certificateFile ? { certificate: nextCertificateUrl } : {}),
                    ...(documentFile ? { document: nextDocumentUrl } : {}),
                    ...(uploadedImageUrls.length > 0
                        ? { images: finalImages }
                        : {}),
                },
                create: {
                    user_id: userId,
                    honor_id: honorId,
                    date: existingUserHonor?.date ?? new Date(),
                    validate: existingUserHonor?.validate ?? false,
                    certificate: certificateFile
                        ? nextCertificateUrl
                        : previousCertificateUrl,
                    images: finalImages,
                    document: documentFile
                        ? nextDocumentUrl
                        : (existingUserHonor?.document ?? null),
                    active: true,
                },
                include: {
                    honors: {
                        select: {
                            honor_id: true,
                            name: true,
                            honor_image: true,
                            honors_categories: { select: { name: true } },
                        },
                    },
                },
            }));
        }
        catch (error) {
            await this.rollbackUploadedObjects(uploadedObjects);
            throw new common_1.InternalServerErrorException('Error al guardar evidencias del honor');
        }
        if (certificateFile &&
            previousCertificateUrl &&
            previousCertificateUrl !== nextCertificateUrl) {
            await this.cleanupPreviousCertificate(previousCertificateUrl);
        }
        if (documentFile &&
            previousDocumentUrl &&
            previousDocumentUrl !== nextDocumentUrl) {
            await this.cleanupPreviousDocument(previousDocumentUrl);
        }
        return {
            status: 'success',
            data: {
                user_honor: await this.mapUserHonorPrivateUrls(updated),
                uploaded: {
                    certificate: certificateFile && nextCertificateUrl
                        ? await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT, nextCertificateUrl)
                        : null,
                    document: documentFile && nextDocumentUrl
                        ? await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS, nextDocumentUrl)
                        : null,
                    images: await Promise.all(uploadedImageUrls.map(async (url) => this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS, url))),
                },
            },
            message: 'Archivos del honor subidos exitosamente',
        };
    }
    async updateUserHonor(userId, honorId, dto) {
        const userHonor = await this.prisma.users_honors.findFirst({
            where: {
                user_id: userId,
                honor_id: honorId,
                active: true,
            },
        });
        if (!userHonor) {
            throw new common_1.NotFoundException('User honor not found');
        }
        const updateData = {
            modified_at: new Date(),
        };
        if (dto.validate !== undefined)
            updateData.validate = dto.validate;
        if (dto.certificate !== undefined) {
            updateData.certificate = dto.certificate || '';
        }
        if (dto.images !== undefined) {
            updateData.images = (dto.images || []);
        }
        if (dto.document !== undefined) {
            updateData.document = dto.document || null;
        }
        if (dto.date)
            updateData.date = new Date(dto.date);
        const updated = await this.prisma.users_honors.update({
            where: { user_honor_id: userHonor.user_honor_id },
            data: updateData,
            include: {
                honors: { select: { name: true, honor_image: true } },
            },
        });
        return this.mapUserHonorPrivateUrls(updated);
    }
    async abandonHonor(userId, honorId) {
        const userHonor = await this.prisma.users_honors.findFirst({
            where: {
                user_id: userId,
                honor_id: honorId,
                active: true,
            },
        });
        if (!userHonor) {
            throw new common_1.NotFoundException('User honor not found');
        }
        return this.prisma.users_honors.update({
            where: { user_honor_id: userHonor.user_honor_id },
            data: {
                active: false,
                modified_at: new Date(),
            },
        });
    }
    async getUserHonorStats(userId) {
        const [total, validated, inProgress] = await Promise.all([
            this.prisma.users_honors.count({
                where: { user_id: userId, active: true },
            }),
            this.prisma.users_honors.count({
                where: { user_id: userId, active: true, validate: true },
            }),
            this.prisma.users_honors.count({
                where: { user_id: userId, active: true, validate: false },
            }),
        ]);
        return {
            total,
            validated,
            in_progress: inProgress,
        };
    }
    buildCreateDataFromCreateDto(dto) {
        return {
            active: true,
            date: dto.date ? new Date(dto.date) : new Date(),
            validate: dto.validate ?? false,
            certificate: dto.certificate || '',
            images: (dto.images || []),
            document: dto.document || null,
        };
    }
    buildUpdateDataFromCreateDto(dto) {
        const data = {
            active: true,
            modified_at: new Date(),
        };
        if (dto.date !== undefined)
            data.date = new Date(dto.date);
        if (dto.validate !== undefined)
            data.validate = dto.validate;
        if (dto.certificate !== undefined)
            data.certificate = dto.certificate || '';
        if (dto.images !== undefined)
            data.images = (dto.images || []);
        if (dto.document !== undefined)
            data.document = dto.document || null;
        return data;
    }
    extractImageUrls(images) {
        if (!Array.isArray(images))
            return [];
        return images.filter((value) => typeof value === 'string');
    }
    getFileExtension(file) {
        const mimeToExtension = {
            'application/pdf': 'pdf',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
        };
        if (mimeToExtension[file.mimetype]) {
            return mimeToExtension[file.mimetype];
        }
        const originalExtension = file.originalname.split('.').pop()?.toLowerCase();
        if (originalExtension)
            return originalExtension;
        return 'bin';
    }
    validateCertificateFile(file) {
        const allowedMimeTypes = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
        ];
        if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Invalid certificate format. Allowed: PDF, JPG, PNG, WEBP');
        }
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new common_1.BadRequestException('Certificate file too large. Max size: 10MB');
        }
    }
    validateImageFile(file) {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Invalid image format. Allowed: JPG, PNG, WEBP');
        }
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new common_1.BadRequestException('Image file too large. Max size: 10MB');
        }
    }
    validateDocumentFile(file) {
        const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
            'image/webp',
        ];
        if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new common_1.BadRequestException('Invalid document format. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP');
        }
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new common_1.BadRequestException('Document file too large. Max size: 10MB');
        }
    }
    async rollbackUploadedObjects(uploadedObjects) {
        if (uploadedObjects.length === 0)
            return;
        const keysByBucket = uploadedObjects.reduce((acc, uploadedObject) => {
            const existing = acc.get(uploadedObject.bucketAlias) ?? [];
            existing.push(uploadedObject.key);
            acc.set(uploadedObject.bucketAlias, existing);
            return acc;
        }, new Map());
        for (const [bucketAlias, keys] of keysByBucket.entries()) {
            try {
                await this.fileStorage.deleteMany(bucketAlias, keys);
            }
            catch (error) {
                this.logger.error(`Critical: failed to rollback uploaded honors objects in ${bucketAlias}. Manual remediation required.`, error);
            }
        }
    }
    async cleanupPreviousCertificate(previousCertificateUrl) {
        const previousKey = this.fileStorage.extractKeyFromPublicUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT, previousCertificateUrl);
        if (!previousKey)
            return;
        try {
            await this.fileStorage.deleteMany(file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT, [
                previousKey,
            ]);
        }
        catch (error) {
            this.logger.warn(`Best-effort cleanup failed for previous certificate: ${previousKey}`, error);
        }
    }
    async cleanupPreviousDocument(previousDocumentUrl) {
        const previousKey = this.fileStorage.extractKeyFromPublicUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS, previousDocumentUrl);
        if (!previousKey)
            return;
        try {
            await this.fileStorage.deleteMany(file_storage_service_1.StorageBucketAlias.USERS_HONORS, [
                previousKey,
            ]);
        }
        catch (error) {
            this.logger.warn(`Best-effort cleanup failed for previous document: ${previousKey}`, error);
        }
    }
    async mapUserHonorPrivateUrls(userHonor) {
        if (!userHonor)
            return userHonor;
        const hasCertificate = Object.prototype.hasOwnProperty.call(userHonor, 'certificate');
        const hasDocument = Object.prototype.hasOwnProperty.call(userHonor, 'document');
        const hasImages = Object.prototype.hasOwnProperty.call(userHonor, 'images');
        const certificate = hasCertificate
            ? await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT, typeof userHonor.certificate === 'string'
                ? userHonor.certificate
                : null)
            : null;
        const document = hasDocument
            ? await this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS, typeof userHonor.document === 'string' ? userHonor.document : null)
            : null;
        let images = userHonor.images;
        if (hasImages && Array.isArray(userHonor.images)) {
            const urls = userHonor.images.filter((value) => typeof value === 'string');
            images = await Promise.all(urls.map((url) => this.resolvePrivateAssetUrl(file_storage_service_1.StorageBucketAlias.USERS_HONORS, url)));
        }
        const mapped = { ...userHonor };
        if (hasCertificate)
            mapped.certificate = certificate ?? '';
        if (hasDocument)
            mapped.document = document ?? null;
        if (hasImages)
            mapped.images = images;
        return mapped;
    }
    async resolvePrivateAssetUrl(bucketAlias, value) {
        if (!value)
            return null;
        try {
            return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
                expiresInSeconds: HonorsService_1.PRIVATE_ASSET_URL_TTL_SECONDS,
            });
        }
        catch (error) {
            this.logger.warn(`Failed to generate signed URL for ${bucketAlias}. Returning original value.`, error);
            return value;
        }
    }
};
exports.HonorsService = HonorsService;
exports.HonorsService = HonorsService = HonorsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(file_storage_service_1.FILE_STORAGE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], HonorsService);
//# sourceMappingURL=honors.service.js.map