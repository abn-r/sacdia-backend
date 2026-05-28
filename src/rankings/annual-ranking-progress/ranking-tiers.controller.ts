import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { RankingTiersService } from './ranking-tiers.service';
import { UpdateRankingTierDto } from './dto/update-ranking-tier.dto';

@ApiTags('Ranking Tiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('ranking-tiers')
export class RankingTiersController {
  constructor(private readonly service: RankingTiersService) {}

  @Get()
  @RequirePermissions('ranking_weights:read')
  @ApiOperation({ summary: 'List active ranking recognition tiers' })
  @ApiResponse({ status: 200, description: 'Ranking tiers' })
  async list() {
    const data = await this.service.listActive();
    return { status: 'success' as const, data };
  }

  @Patch(':id')
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({ summary: 'Update a ranking recognition tier' })
  @ApiResponse({ status: 200, description: 'Ranking tier updated' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRankingTierDto,
  ) {
    const data = await this.service.update(id, dto);
    return { status: 'success' as const, data };
  }
}
