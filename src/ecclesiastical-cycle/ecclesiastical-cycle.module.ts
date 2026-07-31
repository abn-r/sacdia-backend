import { Module } from '@nestjs/common';
import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
/** Ports-only module. Adapters and runtime effects are introduced in later slices. */
@Module({
  providers: [EcclesiasticalCycleDependenciesService],
  exports: [EcclesiasticalCycleDependenciesService],
})
export class EcclesiasticalCycleModule {}
