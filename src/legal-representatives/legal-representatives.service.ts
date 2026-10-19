import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * READ-ONLY since family-profiles Phase 2: guardianships supersede legal
 * representatives. Writes were removed; the table stays untouched until it is
 * dropped in Phase 4.
 */
@Injectable()
export class LegalRepresentativesService {
  constructor(private prisma: PrismaService) {}

  async findOne(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.LEGAL_REP_OWNER_NOT_FOUND);
    }

    const representative = await this.prisma.legal_representatives.findUnique({
      where: { user_id: userId },
      include: {
        representative_user: {
          select: {
            user_id: true,
            email: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        relationship_types: {
          select: {
            relationship_type_id: true,
            name: true,
          },
        },
      },
    });

    if (!representative) {
      return {
        status: 'success',
        data: null,
        hasLegalRepresentative: false,
        message: 'Usuario sin representante legal registrado',
      };
    }

    return {
      status: 'success',
      data: representative,
      hasLegalRepresentative: true,
    };
  }
}
