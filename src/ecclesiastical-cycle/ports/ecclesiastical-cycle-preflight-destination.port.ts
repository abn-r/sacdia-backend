export const ECCLESIASTICAL_CYCLE_DESTINATION_READ_PORT = Symbol(
  'ECCLESIASTICAL_CYCLE_DESTINATION_READ_PORT',
);

export type EcclesiasticalCycleDestinationLookup = {
  localFieldId: number;
  targetYearId: number;
  sourceAssignmentId: string;
  currentClubId: number;
  currentClubSectionId: number;
  targetClassId: number;
};

export type EcclesiasticalCycleDestinationResolution =
  | { state: 'resolved'; clubId: number; clubSectionId: number }
  | { state: 'missing' | 'ambiguous' | 'inactive' };

export interface EcclesiasticalCycleDestinationReadPort {
  destinationInCurrentClub(
    input: EcclesiasticalCycleDestinationLookup,
  ): Promise<EcclesiasticalCycleDestinationResolution>;
}
