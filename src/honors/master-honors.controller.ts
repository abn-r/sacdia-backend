import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  UserMasterHonorDetailDto,
  UserMasterHonorDto,
  UserMasterHonorRoadmapDto,
} from './dto/master-honors.dto';
import { MasterHonorsService } from './master-honors.service';

@ApiTags('user-master-honors')
@Controller('users/:userId/master-honors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserMasterHonorsController {
  constructor(private readonly masterHonorsService: MasterHonorsService) {}

  @Get()
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({
    summary: 'Obtener maestrías del usuario',
    description:
      'Lista las maestrías obtenidas o históricas del usuario, incluyendo estados No vigente.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Maestrías del usuario',
    type: UserMasterHonorDto,
    isArray: true,
  })
  async getUserMasterHonors(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.masterHonorsService.getUserMasterHonors(userId);
  }

  @Get('roadmap')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({
    summary: 'Obtener roadmap de maestrías del usuario',
    description:
      'Lista maestrías activas aplicables con avance y requisitos, incluso si el usuario todavía no obtuvo ninguna.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Roadmap de maestrías del usuario',
    type: UserMasterHonorRoadmapDto,
    isArray: true,
  })
  async getUserMasterHonorRoadmap(
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.masterHonorsService.getUserMasterHonorRoadmap(userId);
  }

  @Get(':masterHonorId')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({
    summary: 'Obtener detalle de una maestría del usuario',
    description:
      'Retorna una maestría del usuario con el snapshot de evaluación vigente.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'masterHonorId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Detalle de maestría del usuario',
    type: UserMasterHonorDetailDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Maestría de usuario no encontrada',
  })
  async getUserMasterHonorDetail(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('masterHonorId', ParseIntPipe) masterHonorId: number,
  ) {
    return this.masterHonorsService.getUserMasterHonorDetail(
      userId,
      masterHonorId,
    );
  }
}
