import { Inject, Injectable } from '@nestjs/common';
import {
  AppConflictException,
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ECCLESIASTICAL_CYCLE_MASTER_GUIDE_PORT,
  ECCLESIASTICAL_CYCLE_CAPABILITY_VERSIONS,
  ECCLESIASTICAL_CYCLE_P0_PORT,
  ECCLESIASTICAL_CYCLE_PROGRESSION_PORT,
  type CanonicalProgressionPort,
  type EcclesiasticalCycleAccessDto,
  type EcclesiasticalCycleCapabilitiesDto,
  type EcclesiasticalCycleCapabilityDto,
  type EcclesiasticalCycleDependency,
  type EcclesiasticalCyclePlanningContextDto,
  type EcclesiasticalCycleP0Port,
  type MasterGuideRenewalPort,
} from './ports/ecclesiastical-cycle-dependencies.port';
@Injectable()
export class EcclesiasticalCycleDependenciesService {
  constructor(
    @Inject(ECCLESIASTICAL_CYCLE_P0_PORT)
    private readonly p0: EcclesiasticalCycleP0Port,
    @Inject(ECCLESIASTICAL_CYCLE_PROGRESSION_PORT)
    private readonly progression: CanonicalProgressionPort,
    @Inject(ECCLESIASTICAL_CYCLE_MASTER_GUIDE_PORT)
    private readonly masterGuide: MasterGuideRenewalPort,
  ) {}
  async capabilities(): Promise<EcclesiasticalCycleCapabilitiesDto> {
    const [p0, progression, masterGuide] = await Promise.all([
      this.p0.capability(),
      this.progression.capability(),
      this.masterGuide.capability(),
    ]);
    return { p0, progression, masterGuide };
  }
  async assertPlanningAccess(
    input: EcclesiasticalCycleAccessDto,
  ): Promise<EcclesiasticalCyclePlanningContextDto> {
    const access = await this.p0.authorize(input);
    if (!access.allowed) {
      throw new AppForbiddenException(ErrorCode.ECCLESIASTICAL_CYCLE_FORBIDDEN);
    }
    const capabilities = await this.capabilities();
    (Object.keys(capabilities) as EcclesiasticalCycleDependency[]).forEach(
      (dependency) =>
        this.assertCompatible(
          dependency,
          capabilities[dependency],
          ECCLESIASTICAL_CYCLE_CAPABILITY_VERSIONS[dependency],
        ),
    );
    return { businessDate: access.businessDate, capabilities };
  }
  private assertCompatible(
    dependency: EcclesiasticalCycleDependency,
    capability: EcclesiasticalCycleCapabilityDto,
    expectedVersion: number,
  ): void {
    const metadata = {
      dependency,
      expectedVersion,
      receivedVersion: capability.version,
    };
    if (!capability.available) {
      throw new AppConflictException(
        ErrorCode.ECCLESIASTICAL_CYCLE_CAPABILITY_UNAVAILABLE,
        { ...metadata, reason: 'CAPABILITY_UNAVAILABLE' },
        { ...metadata, reason: 'CAPABILITY_UNAVAILABLE' },
      );
    }
    if (capability.version !== expectedVersion) {
      throw new AppConflictException(
        ErrorCode.ECCLESIASTICAL_CYCLE_CAPABILITY_VERSION_INCOMPATIBLE,
        { ...metadata, reason: 'CAPABILITY_VERSION_INCOMPATIBLE' },
        { ...metadata, reason: 'CAPABILITY_VERSION_INCOMPATIBLE' },
      );
    }
  }
}
