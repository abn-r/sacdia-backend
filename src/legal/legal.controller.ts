import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../config/throttler.helpers';
import { LegalService } from './legal.service';

@ApiTags('legal')
@Controller('legal')
@SkipPermissions()
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  /**
   * GET /api/v1/legal/current
   * Current Terms/Privacy versions and URLs. Public: register needs them before
   * a session exists.
   */
  @Get('current')
  @Public()
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @ApiOperation({ summary: 'Current legal document versions' })
  @ApiResponse({
    status: 200,
    description: 'Terms and privacy versions with their public URLs',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  document_type: { type: 'string', example: 'terms' },
                  version: { type: 'string', example: '1.0.0-store' },
                  url: { type: 'string', example: 'https://sacdia.com/terms' },
                },
              },
            },
          },
        },
      },
    },
  })
  getCurrent() {
    return {
      status: 'success',
      data: { documents: this.legalService.getCurrent() },
    };
  }
}
