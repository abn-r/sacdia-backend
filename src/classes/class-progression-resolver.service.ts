import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

type ProgressionClass = {
  class_id: number;
  club_type_id: number;
  display_order: number;
};

@Injectable()
export class ClassProgressionResolver {
  async resolveFirst(
    tx: Prisma.TransactionClient,
    clubTypeId: number,
    yearStart: Date,
  ): Promise<ProgressionClass> {
    const classes = await this.loadTrack(tx, clubTypeId, yearStart);
    return classes[0];
  }

  async resolvePredecessor(
    tx: Prisma.TransactionClient,
    classId: number,
    yearStart: Date,
  ): Promise<ProgressionClass | null> {
    const target = await this.loadClass(tx, classId);
    const classes = await this.loadTrack(tx, target.club_type_id, yearStart);
    const index = classes.findIndex((item) => item.class_id === classId);
    this.assertClassAvailable(index);
    if (index > 0) return classes[index - 1];

    const transitions = await tx.class_progression_track_transitions.findMany({
      where: {
        active: true,
        to_track: { active: true, club_type_id: target.club_type_id },
        from_track: { active: true },
      },
      select: { from_track: { select: { club_type_id: true } } },
    });
    if (transitions.length === 0) return null;
    if (transitions.length !== 1) this.invalidConfig();

    const predecessorTrack = await this.loadTrack(
      tx,
      transitions[0].from_track.club_type_id,
      yearStart,
    );
    return predecessorTrack[predecessorTrack.length - 1];
  }

  async resolveNext(
    tx: Prisma.TransactionClient,
    classId: number,
    yearStart: Date,
  ): Promise<ProgressionClass | null> {
    const source = await this.loadClass(tx, classId);
    const classes = await this.loadTrack(tx, source.club_type_id, yearStart);
    const index = classes.findIndex((item) => item.class_id === classId);
    this.assertClassAvailable(index);
    if (index < classes.length - 1) return classes[index + 1];

    const transitions = await tx.class_progression_track_transitions.findMany({
      where: {
        active: true,
        from_track: { active: true, club_type_id: source.club_type_id },
        to_track: { active: true },
      },
      select: { to_track: { select: { club_type_id: true } } },
    });
    if (transitions.length === 0) return null;
    if (transitions.length !== 1) this.invalidConfig();
    return this.resolveFirst(
      tx,
      transitions[0].to_track.club_type_id,
      yearStart,
    );
  }

  async resolveTransition(
    tx: Prisma.TransactionClient,
    sourceClassId: number,
    targetClassId: number,
    yearStart: Date,
  ): Promise<'SAME_TRACK' | 'CROSSOVER'> {
    const source = await this.loadClass(tx, sourceClassId);
    const target = await this.loadClass(tx, targetClassId);
    const next = await this.resolveNext(tx, sourceClassId, yearStart);
    if (!next || next.class_id !== targetClassId) {
      throw new AppBadRequestException(ErrorCode.CLASS_LEVEL_TOO_HIGH);
    }
    return source.club_type_id === target.club_type_id
      ? 'SAME_TRACK'
      : 'CROSSOVER';
  }

  private async loadClass(tx: Prisma.TransactionClient, classId: number) {
    const result = await tx.classes.findUnique({
      where: { class_id: classId },
      select: { class_id: true, club_type_id: true, display_order: true },
    });
    if (!result) {
      throw new AppBadRequestException(ErrorCode.CLASS_NOT_FOUND);
    }
    return result;
  }

  private async loadTrack(
    tx: Prisma.TransactionClient,
    clubTypeId: number,
    yearStart: Date,
  ): Promise<ProgressionClass[]> {
    const track = await tx.class_progression_tracks.findFirst({
      where: { club_type_id: clubTypeId, active: true },
      select: { class_progression_track_id: true },
    });
    if (!track) this.invalidConfig();

    const classes = await tx.classes.findMany({
      where: {
        club_type_id: clubTypeId,
        active: true,
        AND: [
          {
            OR: [
              { available_from_year_id: null },
              { available_from_year: { start_date: { lte: yearStart } } },
            ],
          },
          {
            OR: [
              { available_until_year_id: null },
              { available_until_year: { start_date: { gte: yearStart } } },
            ],
          },
        ],
      },
      select: { class_id: true, club_type_id: true, display_order: true },
      orderBy: [{ display_order: 'asc' }, { class_id: 'asc' }],
    });
    if (
      classes.length === 0 ||
      classes.some(
        (item, index) =>
          index > 0 && item.display_order === classes[index - 1].display_order,
      )
    ) {
      this.invalidConfig();
    }
    return classes;
  }

  private assertClassAvailable(index: number): void {
    if (index < 0) {
      throw new AppBadRequestException(ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR);
    }
  }

  private invalidConfig(): never {
    throw new AppBadRequestException(
      ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    );
  }
}
