import { Module } from '@nestjs/common';
import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
import { EcclesiasticalCycleCandidatePreflightService } from './ecclesiastical-cycle-candidate-preflight.service';
import { EcclesiasticalCycleDestinationPreflightService } from './ecclesiastical-cycle-destination-preflight.service';
import { EcclesiasticalCyclePreflightController } from './ecclesiastical-cycle-preflight.controller';
/** Contract-only module. Adapters and AppModule wiring arrive in later slices. */
@Module({
  controllers: [EcclesiasticalCyclePreflightController],
  providers: [
    EcclesiasticalCycleDependenciesService,
    EcclesiasticalCycleCandidatePreflightService,
    EcclesiasticalCycleDestinationPreflightService,
  ],
  exports: [
    EcclesiasticalCycleDependenciesService,
    EcclesiasticalCycleCandidatePreflightService,
    EcclesiasticalCycleDestinationPreflightService,
  ],
})
export class EcclesiasticalCycleModule {}
