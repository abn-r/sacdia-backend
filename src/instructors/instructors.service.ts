import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { escapeLikeWildcards } from '../common/utils/escape-like';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import { PrismaService } from '../prisma/prisma.service';
import {
  INSTRUCTOR_QUERY_MIN,
  INSTRUCTOR_TOKEN_MIN,
} from './dto/search-instructor-candidates.dto';

export const INSTRUCTOR_CANDIDATE_LIMIT = 10;
export const INSTRUCTOR_MIN_AGE = 18;
const PHOTO_URL_TTL_SECONDS = 600;

/** Única forma pública de un candidato (D2): nombre y foto, nada más. */
export type InstructorCandidateView = {
  user_id: string;
  display_name: string;
  photo_url: string | null;
};

/** Último día de nacimiento que ya cumple la mayoría de edad hoy. */
export function adultBirthdayCutoff(now: Date = new Date()): Date {
  const year = now.getUTCFullYear() - INSTRUCTOR_MIN_AGE;
  const cutoff = new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate()));
  // 29 de febrero hacia un año no bisiesto: se queda en el 28, no pasa a marzo.
  if (cutoff.getUTCMonth() !== now.getUTCMonth()) {
    return new Date(Date.UTC(year, now.getUTCMonth() + 1, 0));
  }
  return cutoff;
}

/**
 * Filtro de elegibilidad compartido por el buscador y `assertEligible`: la
 * misma unidad de código decide quién se ofrece y quién se acepta. Sin rol ni
 * Guía Mayor (D2). `birthday` nulo queda fuera (la comparación no lo cumple), y
 * una cuenta anonimizada también: pierde `active`, `birthday` y `local_field_id`.
 */
export function eligibleInstructorWhere(
  localFieldId: number,
  now: Date = new Date(),
): Prisma.usersWhereInput {
  return {
    active: true,
    approval_status: 'approved',
    local_field_id: localFieldId,
    birthday: { lte: adultBirthdayCutoff(now) },
  };
}

@Injectable()
export class InstructorsService {
  private readonly logger = new Logger(InstructorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * Busca instructores del MISMO Campo Local de quien llama. Nunca por correo.
   * Un `q` corto o vacío, o un llamante sin Campo Local, devuelve `[]`.
   */
  async searchCandidates(
    callerUserId: string,
    query: string | undefined,
  ): Promise<InstructorCandidateView[]> {
    const tokens = (query ?? '').trim().split(/\s+/).filter(Boolean);
    if (
      tokens.join(' ').length < INSTRUCTOR_QUERY_MIN ||
      tokens.some((token) => token.length < INSTRUCTOR_TOKEN_MIN)
    ) {
      return [];
    }
    const caller = await this.prisma.users.findUnique({
      where: { user_id: callerUserId },
      select: { local_field_id: true },
    });
    if (caller?.local_field_id == null) {
      return [];
    }
    const rows = await this.prisma.users.findMany({
      where: {
        AND: [
          eligibleInstructorWhere(caller.local_field_id),
          { user_id: { not: callerUserId } },
          ...tokens
            .map(escapeLikeWildcards)
            .map((token): Prisma.usersWhereInput => ({
              OR: [
                { name: { contains: token, mode: 'insensitive' } },
                {
                  paternal_last_name: { contains: token, mode: 'insensitive' },
                },
                {
                  maternal_last_name: { contains: token, mode: 'insensitive' },
                },
              ],
            })),
        ],
      },
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
      },
      orderBy: [
        { name: 'asc' },
        { paternal_last_name: 'asc' },
        { maternal_last_name: 'asc' },
        { user_id: 'asc' },
      ],
      take: INSTRUCTOR_CANDIDATE_LIMIT,
    });
    return Promise.all(
      rows.map(async (row) => ({
        user_id: row.user_id,
        display_name: displayName(row),
        photo_url: await this.signPhoto(row.user_image),
      })),
    );
  }

  /**
   * Valida un instructor del sistema contra el DUEÑO de la especialidad, no
   * contra quien llama. Un solo error público (`INVALID`) para no revelar si el
   * usuario existe fuera del alcance. El alcance se evalúa solo al elegir.
   */
  async assertEligible(
    ownerUserId: string,
    instructorUserId: string,
  ): Promise<void> {
    if (ownerUserId === instructorUserId) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_SELF);
    }
    const owner = await this.prisma.users.findUnique({
      where: { user_id: ownerUserId },
      select: { local_field_id: true },
    });
    if (owner?.local_field_id == null) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_INVALID);
    }
    const instructor = await this.prisma.users.findFirst({
      where: {
        user_id: instructorUserId,
        ...eligibleInstructorWhere(owner.local_field_id),
      },
      select: { user_id: true },
    });
    if (!instructor) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_INVALID);
    }
  }

  /** Foto firmada (TTL corto) por usuario; `null` si no tiene o falla la firma. */
  async photoUrlsFor(
    users: ReadonlyArray<{ user_id: string; user_image: string | null }>,
  ): Promise<Map<string, string | null>> {
    const urls = new Map<string, string | null>();
    await Promise.all(
      users.map(async (user) =>
        urls.set(user.user_id, await this.signPhoto(user.user_image)),
      ),
    );
    return urls;
  }

  private async signPhoto(value: string | null): Promise<string | null> {
    if (!value) return null;
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        { expiresInSeconds: PHOTO_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sign instructor photo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
