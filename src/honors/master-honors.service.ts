import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserMasterHonorDetailDto,
  UserMasterHonorDto,
  UserMasterHonorDisplayStatusLabel,
  UserMasterHonorStatus,
} from './dto/master-honors.dto';

const CURRENT_MASTER_HONOR_STATUSES: UserMasterHonorStatus[] = [
  'AWARDED',
  'REVOKED',
  'RETIRED',
];

type UserMasterHonorRow = Prisma.users_master_honorsGetPayload<{
  select: {
    user_master_honor_id: true;
    master_honor_id: true;
    status: true;
    awarded_at: true;
    revoked_at: true;
    recovered_at: true;
    status_reason: true;
    evaluation_snapshot: true;
    master_honor: {
      select: {
        name: true;
        master_image: true;
      };
    };
  };
}>;

@Injectable()
export class MasterHonorsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserMasterHonors(userId: string): Promise<UserMasterHonorDto[]> {
    const records = await this.prisma.users_master_honors.findMany({
      where: {
        user_id: userId,
        active: true,
        status: { in: CURRENT_MASTER_HONOR_STATUSES },
      },
      select: this.userMasterHonorSelect(),
      orderBy: [{ awarded_at: 'desc' }, { created_at: 'desc' }],
      take: 500,
    });

    return records.map((record) => this.toDto(record));
  }

  async getUserMasterHonorDetail(
    userId: string,
    masterHonorId: number,
  ): Promise<UserMasterHonorDetailDto> {
    const record = await this.prisma.users_master_honors.findFirst({
      where: {
        user_id: userId,
        master_honor_id: masterHonorId,
        active: true,
        status: { in: CURRENT_MASTER_HONOR_STATUSES },
      },
      select: this.userMasterHonorSelect(),
    });

    if (!record) {
      throw new NotFoundException('User master honor not found');
    }

    return {
      ...this.toDto(record),
      evaluation_snapshot: record.evaluation_snapshot,
    };
  }

  private userMasterHonorSelect() {
    return {
      user_master_honor_id: true,
      master_honor_id: true,
      status: true,
      awarded_at: true,
      revoked_at: true,
      recovered_at: true,
      status_reason: true,
      evaluation_snapshot: true,
      master_honor: {
        select: {
          name: true,
          master_image: true,
        },
      },
    } satisfies Prisma.users_master_honorsSelect;
  }

  private toDto(record: UserMasterHonorRow): UserMasterHonorDto {
    const isCurrent = record.status === 'AWARDED';

    return {
      user_master_honor_id: record.user_master_honor_id,
      master_honor_id: record.master_honor_id,
      name: record.master_honor.name,
      master_image: record.master_honor.master_image,
      status: record.status as UserMasterHonorStatus,
      is_current: isCurrent,
      display_status_label: this.getDisplayStatusLabel(isCurrent),
      awarded_at: this.toIsoString(record.awarded_at),
      revoked_at: this.toIsoString(record.revoked_at),
      recovered_at: this.toIsoString(record.recovered_at),
      status_reason: record.status_reason,
    };
  }

  private getDisplayStatusLabel(
    isCurrent: boolean,
  ): UserMasterHonorDisplayStatusLabel {
    return isCurrent ? 'Vigente' : 'No vigente';
  }

  private toIsoString(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }
}
