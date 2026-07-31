import type { BusinessDate } from '../../common/clock/zoned-business-time.service';
export const ECCLESIASTICAL_CYCLE_P0_PORT = Symbol(
  'ECCLESIASTICAL_CYCLE_P0_PORT',
);
export const ECCLESIASTICAL_CYCLE_PROGRESSION_PORT = Symbol(
  'ECCLESIASTICAL_CYCLE_PROGRESSION_PORT',
);
export const ECCLESIASTICAL_CYCLE_MASTER_GUIDE_PORT = Symbol(
  'ECCLESIASTICAL_CYCLE_MASTER_GUIDE_PORT',
);
export const ECCLESIASTICAL_CYCLE_CAPABILITY_VERSIONS = {
  p0: 1,
  progression: 1,
  masterGuide: 1,
} as const;
export type EcclesiasticalCycleCapabilityDto = {
  available: boolean;
  version: number;
  reason?: 'CAPABILITY_UNAVAILABLE';
};
export type EcclesiasticalCycleDependency =
  | 'p0'
  | 'progression'
  | 'masterGuide';
export type EcclesiasticalCycleCapabilityFailureDto = {
  dependency: EcclesiasticalCycleDependency;
  expectedVersion: number;
  receivedVersion: number;
  reason: 'CAPABILITY_UNAVAILABLE' | 'CAPABILITY_VERSION_INCOMPATIBLE';
};
export type EcclesiasticalCycleCapabilitiesDto = {
  p0: EcclesiasticalCycleCapabilityDto;
  progression: EcclesiasticalCycleCapabilityDto;
  masterGuide: EcclesiasticalCycleCapabilityDto;
};
export type EcclesiasticalCyclePlanningContextDto = {
  businessDate: BusinessDate;
  timezone: string | null;
  capabilities: EcclesiasticalCycleCapabilitiesDto;
};
export type EcclesiasticalCycleAccessDto = {
  actorUserId: string;
  localFieldId: number;
  targetYearId: number;
};
export type EcclesiasticalCycleP0Access =
  | {
      allowed: true;
      businessDate: BusinessDate;
      timezone: string | null;
      effectiveSuccessionObserved: true;
    }
  | { allowed: false; reason?: string };
export type CanonicalProgressionResolution =
  | { state: 'resolved'; targetClassId: number; transitionId?: number | null }
  | { state: 'missing' | 'ambiguous'; reason: string };
export interface EcclesiasticalCycleP0Port {
  capability(): Promise<EcclesiasticalCycleCapabilityDto>;
  authorize(
    input: EcclesiasticalCycleAccessDto,
  ): Promise<EcclesiasticalCycleP0Access>;
}
export interface CanonicalProgressionPort {
  capability(): Promise<EcclesiasticalCycleCapabilityDto>;
  resolve(input: {
    sourceEnrollmentId: number;
    targetYearId: number;
  }): Promise<CanonicalProgressionResolution>;
}
export interface MasterGuideRenewalPort {
  capability(): Promise<EcclesiasticalCycleCapabilityDto>;
  renew(input: {
    enrollmentId: number;
    targetYearId: number;
    actorUserId: string;
  }): Promise<{ enrollmentId: number; renewedFromEnrollmentId: number }>;
}
