import {
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CamporeesService } from './camporees.service';

@ApiTags('camporee-club-registration')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CamporeeClubRegistrationController {
  constructor(private readonly camporeesService: CamporeesService) {}

  @Post('camporees/:camporeeId/club-registration/close')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Close local camporee club registration' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async closeLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Request() req: any,
  ) {
    const data = await this.camporeesService.closeLocalCamporeeClubRegistration(
      camporeeId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Post('camporees/:camporeeId/club-registration/reopen')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Reopen local camporee club registration' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async reopenLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Request() req: any,
  ) {
    const data =
      await this.camporeesService.reopenLocalCamporeeClubRegistration(
        camporeeId,
        req.user.sub,
      );
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/club-registration/close')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Close union camporee club registration' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async closeUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Request() req: any,
  ) {
    const data = await this.camporeesService.closeUnionCamporeeClubRegistration(
      camporeeId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/club-registration/reopen')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Reopen union camporee club registration' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async reopenUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Request() req: any,
  ) {
    const data =
      await this.camporeesService.reopenUnionCamporeeClubRegistration(
        camporeeId,
        req.user.sub,
      );
    return { status: 'success', data };
  }
}
