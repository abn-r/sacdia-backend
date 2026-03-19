import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards';
import { CreateInsuranceDto } from './dto/create-insurance.dto';
import { UpdateInsuranceDto } from './dto/update-insurance.dto';
import { InsuranceService } from './insurance.service';

type CurrentUserPayload = {
  sub?: string;
  user_id?: string;
  userId?: string;
};

@ApiTags('insurance')
@Controller('api/v1')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InsuranceController {
  constructor(private readonly service: InsuranceService) {}

  @Get('clubs/:clubId/sections/:sectionId/members/insurance')
  @ApiOperation({ summary: 'Listar seguros de miembros por sección' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de seguros por miembro' })
  async listMembersInsurance(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    const data = await this.service.listMembersInsurance(clubId, sectionId);
    return { status: 'success', data };
  }

  @Get('users/:memberId/insurance')
  @ApiOperation({ summary: 'Obtener seguro activo del miembro' })
  @ApiParam({ name: 'memberId', type: String })
  @ApiResponse({ status: 200, description: 'Seguro del miembro' })
  async getMemberInsurance(@Param('memberId') memberId: string) {
    const data = await this.service.getMemberInsurance(memberId);
    return { status: 'success', data };
  }

  @Post('users/:memberId/insurance')
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Crear seguro para un miembro' })
  @ApiParam({ name: 'memberId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        insurance_type: { type: 'string' },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        policy_number: { type: 'string' },
        provider: { type: 'string' },
        coverage_amount: { type: 'number' },
        evidence: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Seguro creado' })
  async createInsurance(
    @Param('memberId') memberId: string,
    @Body() dto: CreateInsuranceDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const currentUserId = this.extractCurrentUserId(user);
    const data = await this.service.createInsurance(
      memberId,
      dto,
      file,
      currentUserId,
    );
    return { status: 'success', data };
  }

  @Patch('insurance/:insuranceId')
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Actualizar seguro' })
  @ApiParam({ name: 'insuranceId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        insurance_type: { type: 'string' },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        policy_number: { type: 'string' },
        provider: { type: 'string' },
        coverage_amount: { type: 'number' },
        evidence: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Seguro actualizado' })
  async updateInsurance(
    @Param('insuranceId', ParseIntPipe) insuranceId: number,
    @Body() dto: UpdateInsuranceDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const currentUserId = this.extractCurrentUserId(user);
    const data = await this.service.updateInsurance(
      insuranceId,
      dto,
      file,
      currentUserId,
    );
    return { status: 'success', data };
  }

  private extractCurrentUserId(user?: {
    sub?: string;
    user_id?: string;
    userId?: string;
  }): string | undefined {
    return user?.sub ?? user?.user_id ?? user?.userId;
  }
}
