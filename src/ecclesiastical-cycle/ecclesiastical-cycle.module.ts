import { Module } from '@nestjs/common';
import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
import { EcclesiasticalCycleCandidatePreflightService } from './ecclesiastical-cycle-candidate-preflight.service';
/** Contract-only module. Adapters and AppModule wiring arrive in later slices. */
@Module({
  providers: [
    EcclesiasticalCycleDependenciesService,
    EcclesiasticalCycleCandidatePreflightService,
  ],
  exports: [
    EcclesiasticalCycleDependenciesService,
    EcclesiasticalCycleCandidatePreflightService,
  ],
})
export class EcclesiasticalCycleModule {}
