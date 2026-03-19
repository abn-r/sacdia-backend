import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';

type InsuranceMutationInput = {
  insurance_type?: string;
  start_date?: string | Date;
  end_date?: string | Date;
  policy_number?: string | null;
  provider?: string | null;
  coverage_amount?: number | string | null;
  active?: boolean | string | null;
};

type UserClassSnapshot = {
  current_class?: boolean;
  classes?: { name?: string | null } | null;
};

type MemberSnapshot = {
  user_id: string;
  name?: string | null;
  paternal_last_name?: string | null;
  maternal_last_name?: string | null;
  user_image?: string | null;
  users_classes?: UserClassSnapshot[];
};

type InsuranceSnapshot = {
  insurance_id: number;
  user_id: string;
  insurance_type?: string;
  policy_number?: string | null;
  provider?: string | null;
  start_date?: Date | string;
  end_date?: Date | string;
  coverage_amount?: number | string | null;
  active?: boolean;
  evidence_file_url?: string | null;
  evidence_file_name?: string | null;
  created_at?: Date | string;
  modified_at?: Date | string;
  created_by?: { name?: string | null } | null;
  modified_by?: { name?: string | null } | null;
  created_by_name?: string | null;
  modified_by_name?: string | null;
};

@Injectable()
export class InsuranceService {
  private readonly logger = new Logger(InsuranceService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async listMembersInsurance(clubId: number, sectionId: number) {
    void clubId;

    const assignments = await this.db.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        active: true,
      },
      select: {
        user_id: true,
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            user_image: true,
            users_classes: {
              where: {
                active: true,
              },
              orderBy: {
                created_at: 'desc',
              },
              select: {
                current_class: true,
                classes: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    const uniqueMembers = this.uniqueMembers(assignments);
    const result: Record<string, any>[] = [];

    for (const member of uniqueMembers) {
      const insurance = await this.loadLatestActiveInsurance(member.user_id);
      result.push(await this.mapMemberInsurance(member, insurance));
    }

    return result;
  }

  async getMemberInsurance(memberId: string) {
    const member = await this.loadMemberSnapshot(memberId);
    if (!member) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const insurance = await this.loadLatestActiveInsurance(memberId);
    return this.mapMemberInsuranceDetail(member, insurance);
  }

  async createInsurance(
    memberId: string,
    dto: InsuranceMutationInput,
    file?: Express.Multer.File,
    currentUserId?: string,
  ) {
    if (!currentUserId) {
      throw new BadRequestException('Current user is required');
    }

    const member = await this.loadMemberSnapshot(memberId);
    if (!member) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const fileData = await this.uploadEvidenceFile(memberId, file);
    const insuranceType = this.normalizeInsuranceType(dto.insurance_type);
    if (!insuranceType) {
      throw new BadRequestException('insurance_type is required');
    }

    await this.db.member_insurances.create({
      data: {
        user_id: memberId,
        insurance_type: insuranceType,
        policy_number: this.normalizeNullableString(dto.policy_number),
        provider: this.normalizeNullableString(dto.provider),
        start_date: this.parseDateOrThrow(dto.start_date, 'start_date'),
        end_date: this.parseDateOrThrow(dto.end_date, 'end_date'),
        coverage_amount: this.parseCoverageAmount(dto.coverage_amount),
        active: dto.active === undefined ? true : this.parseBoolean(dto.active),
        created_by_id: currentUserId,
        ...(fileData
          ? {
              evidence_file_url: fileData.url,
              evidence_file_name: fileData.name,
            }
          : {}),
      },
    });

    return this.mapMemberInsuranceDetail(
      member,
      await this.loadLatestActiveInsurance(memberId),
    );
  }

  async updateInsurance(
    insuranceId: number,
    dto: InsuranceMutationInput,
    file?: Express.Multer.File,
    currentUserId?: string,
  ) {
    if (!currentUserId) {
      throw new BadRequestException('Current user is required');
    }

    const existing = await this.db.member_insurances.findUnique({
      where: { insurance_id: insuranceId },
      select: {
        insurance_id: true,
        user_id: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Insurance not found');
    }

    const fileData = await this.uploadEvidenceFile(existing.user_id, file);
    const updateData: Record<string, any> = {
      modified_by_id: currentUserId,
    };

    if (dto.insurance_type !== undefined) {
      updateData.insurance_type = this.normalizeInsuranceType(
        dto.insurance_type,
      );
    }
    if (dto.policy_number !== undefined) {
      updateData.policy_number = this.normalizeNullableString(
        dto.policy_number,
      );
    }
    if (dto.provider !== undefined) {
      updateData.provider = this.normalizeNullableString(dto.provider);
    }
    if (dto.start_date !== undefined) {
      updateData.start_date = this.parseDateOrThrow(
        dto.start_date,
        'start_date',
      );
    }
    if (dto.end_date !== undefined) {
      updateData.end_date = this.parseDateOrThrow(dto.end_date, 'end_date');
    }
    if (dto.coverage_amount !== undefined) {
      updateData.coverage_amount = this.parseCoverageAmount(
        dto.coverage_amount,
      );
    }
    if (dto.active !== undefined) {
      updateData.active = this.parseBoolean(dto.active);
    }
    if (fileData) {
      updateData.evidence_file_url = fileData.url;
      updateData.evidence_file_name = fileData.name;
    }

    await this.db.member_insurances.update({
      where: { insurance_id: insuranceId },
      data: updateData,
    });

    const member = await this.loadMemberSnapshot(existing.user_id);
    if (!member) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.mapMemberInsuranceDetail(
      member,
      await this.loadLatestActiveInsurance(existing.user_id),
    );
  }

  private async loadMemberSnapshot(memberId: string) {
    const member = await this.db.users.findUnique({
      where: { user_id: memberId },
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        users_classes: {
          where: {
            active: true,
          },
          orderBy: {
            created_at: 'desc',
          },
          select: {
            current_class: true,
            classes: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!member) {
      return null;
    }

    return {
      ...member,
      user_image: member.user_image ?? null,
    } as MemberSnapshot;
  }

  private async loadLatestActiveInsurance(memberId: string) {
    const insurance = await this.db.member_insurances.findFirst({
      where: {
        user_id: memberId,
        active: true,
      },
      orderBy: [
        {
          modified_at: 'desc',
        },
        {
          created_at: 'desc',
        },
      ],
      include: {
        created_by: {
          select: {
            name: true,
          },
        },
        modified_by: {
          select: {
            name: true,
          },
        },
      },
    });

    return (insurance ?? null) as InsuranceSnapshot | null;
  }

  private async mapMemberInsurance(
    member: MemberSnapshot,
    insurance: InsuranceSnapshot | null,
  ) {
    const currentClass = this.extractCurrentClass(member.users_classes);
    const userImage = await this.resolvePrivateAssetUrl(
      StorageBucketAlias.USER_PROFILES,
      member.user_image ?? null,
    );

    const response: Record<string, any> = {
      user_id: member.user_id,
      name: member.name ?? null,
      paternal_last_name: member.paternal_last_name ?? null,
      maternal_last_name: member.maternal_last_name ?? null,
      user_image: userImage,
      insurance: insurance ? this.mapInsurance(insurance) : null,
    };

    if (currentClass) {
      response.current_class = currentClass;
    }

    return response;
  }

  private async mapMemberInsuranceDetail(
    member: MemberSnapshot,
    insurance: InsuranceSnapshot | null,
  ) {
    const currentClass = this.extractCurrentClass(member.users_classes);
    const userImage = await this.resolvePrivateAssetUrl(
      StorageBucketAlias.USER_PROFILES,
      member.user_image ?? null,
    );

    const user = {
      user_id: member.user_id,
      name: member.name ?? null,
      paternal_last_name: member.paternal_last_name ?? null,
      maternal_last_name: member.maternal_last_name ?? null,
      user_image: userImage,
    };

    const response: Record<string, any> = {
      user_id: member.user_id,
      user,
      insurance: insurance ? this.mapInsurance(insurance) : null,
    };

    if (currentClass) {
      response.current_class = currentClass;
      (response.user as Record<string, any>).current_class = currentClass;
    }

    return response;
  }

  private mapInsurance(insurance: InsuranceSnapshot) {
    return {
      insurance_id: insurance.insurance_id,
      insurance_type: insurance.insurance_type ?? null,
      policy_number: insurance.policy_number ?? null,
      provider: insurance.provider ?? null,
      start_date: insurance.start_date ?? null,
      end_date: insurance.end_date ?? null,
      coverage_amount: this.normalizeCoverageAmount(insurance.coverage_amount),
      active: insurance.active ?? null,
      evidence_file_url: insurance.evidence_file_url ?? null,
      evidence_file_name: insurance.evidence_file_name ?? null,
      created_at: insurance.created_at ?? null,
      modified_at: insurance.modified_at ?? null,
      created_by_name:
        insurance.created_by?.name ?? insurance.created_by_name ?? null,
      modified_by_name:
        insurance.modified_by?.name ?? insurance.modified_by_name ?? null,
    };
  }

  private extractCurrentClass(classes?: UserClassSnapshot[] | null) {
    const current = classes?.find((item) => item.current_class);
    const className = current?.classes?.name ?? null;
    if (!className) return null;
    return { name: className };
  }

  private uniqueMembers(
    assignments: Array<{ user_id: string } & Record<string, any>>,
  ) {
    const seen = new Set<string>();
    const members: MemberSnapshot[] = [];

    for (const assignment of assignments ?? []) {
      const member = assignment.users ?? assignment;
      const userId = member?.user_id ?? assignment.user_id;
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      members.push({
        user_id: userId,
        name: member?.name ?? null,
        paternal_last_name: member?.paternal_last_name ?? null,
        maternal_last_name: member?.maternal_last_name ?? null,
        user_image: member?.user_image ?? null,
        users_classes: member?.users_classes ?? [],
      });
    }

    return members;
  }

  private async uploadEvidenceFile(
    memberId: string,
    file?: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      return null;
    }

    const extension = this.resolveFileExtension(file);
    const key = `insurance-${memberId}-${Date.now()}.${extension}`;
    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.INSURANCE_EVIDENCE,
      key,
      file.buffer,
      { contentType: file.mimetype },
    );

    return {
      url: uploaded.url,
      name: file.originalname || key,
    };
  }

  private resolveFileExtension(file: Express.Multer.File) {
    const original = file.originalname?.trim() ?? '';
    const originalExtension = original.includes('.')
      ? original.split('.').pop()?.toLowerCase()
      : '';

    if (originalExtension) {
      return originalExtension;
    }

    const mimeToExt: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    return mimeToExt[file.mimetype?.toLowerCase()] ?? 'bin';
  }

  private normalizeInsuranceType(value?: string | null) {
    if (value === undefined || value === null) {
      return undefined;
    }

    const normalized = value.toString().trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('insurance_type is required');
    }

    if (
      normalized !== 'GENERAL_ACTIVITIES' &&
      normalized !== 'CAMPOREE' &&
      normalized !== 'HIGH_RISK'
    ) {
      throw new BadRequestException('Invalid insurance_type');
    }

    return normalized;
  }

  private normalizeNullableString(value?: string | null) {
    if (value === undefined || value === null) {
      return undefined;
    }

    const trimmed = value.toString().trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseCoverageAmount(value?: number | string | null) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('coverage_amount must be numeric');
    }

    return parsed;
  }

  private parseDateOrThrow(
    value: string | Date | undefined | null,
    field: string,
  ) {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`${field} is required`);
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is invalid`);
    }

    return date;
  }

  private parseBoolean(value: boolean | string | null | undefined) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === null || value === undefined) {
      return false;
    }

    return ['true', '1', 'yes', 'on'].includes(value.toString().toLowerCase());
  }

  private normalizeCoverageAmount(value?: number | string | null) {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  private async resolvePrivateAssetUrl(
    bucketAlias: StorageBucketAlias,
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
        expiresInSeconds: InsuranceService.PRIVATE_ASSET_URL_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to generate signed URL for ${bucketAlias}. Returning original value.`,
        error,
      );
      return value;
    }
  }
}
