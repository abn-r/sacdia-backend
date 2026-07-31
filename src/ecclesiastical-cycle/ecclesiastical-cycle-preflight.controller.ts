import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards';
import { EcclesiasticalCycleDestinationPreflightService } from './ecclesiastical-cycle-destination-preflight.service';
@Controller('ecclesiastical-cycles')
@UseGuards(JwtAuthGuard)
export class EcclesiasticalCyclePreflightController {
  constructor(
    private readonly cyclePreflight: EcclesiasticalCycleDestinationPreflightService,
  ) {}

  @Get(':targetYearId/preflight')
  preflight(
    @Param('targetYearId', ParseIntPipe) targetYearId: number,
    @Query('localFieldId', ParseIntPipe) localFieldId: number,
    @CurrentUser() actor: { sub: string },
  ) {
    return this.cyclePreflight.execute({
      actorUserId: actor.sub,
      localFieldId,
      targetYearId,
    });
  }
}
