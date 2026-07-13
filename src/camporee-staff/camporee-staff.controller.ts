import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
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
import { CamporeeStaffService } from './camporee-staff.service';
import { AddCamporeeStaffMemberDto, UpdateCamporeeStaffMemberDto } from './dto';

@ApiTags('camporee-staff')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CamporeeStaffController {
  constructor(private readonly service: CamporeeStaffService) {}

  @Get('local-camporees/:camporeeId/staff')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List staff roster for a local camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listLocalStaff(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    const data = await this.service.listStaff({ type: 'local', camporeeId });
    return { status: 'success', data };
  }

  @Get('local-camporees/:camporeeId/staff-candidates')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'List active users eligible for a local camporee roster',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listLocalStaffCandidates(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listStaffCandidates({
      type: 'local',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Post('local-camporees/:camporeeId/staff')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Add a staff member to a local camporee roster' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async addLocalStaff(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AddCamporeeStaffMemberDto,
    @Request() req: any,
  ) {
    const data = await this.service.addStaffMember(
      { type: 'local', camporeeId },
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/staff')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List staff roster for a union camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listUnionStaff(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    const data = await this.service.listStaff({ type: 'union', camporeeId });
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/staff-candidates')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'List active users eligible for a union camporee roster',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listUnionStaffCandidates(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listStaffCandidates({
      type: 'union',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/staff')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Add a staff member to a union camporee roster' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async addUnionStaff(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AddCamporeeStaffMemberDto,
    @Request() req: any,
  ) {
    const data = await this.service.addStaffMember(
      { type: 'union', camporeeId },
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch('camporee-staff/:staffMemberId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Update a camporee staff roster member' })
  async updateStaffMember(
    @Param('staffMemberId', ParseUUIDPipe) staffMemberId: string,
    @Body() dto: UpdateCamporeeStaffMemberDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateStaffMember(
      staffMemberId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('camporee-staff/:staffMemberId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Deactivate a camporee staff roster member' })
  async deleteStaffMember(
    @Param('staffMemberId', ParseUUIDPipe) staffMemberId: string,
    @Request() req: any,
  ) {
    const data = await this.service.deactivateStaffMember(
      staffMemberId,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
