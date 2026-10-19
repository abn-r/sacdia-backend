import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../config/throttler.helpers';
import {
  sessionContextFromRequest,
  type SessionContextRequest,
} from '../auth/session-request-context';
import { AcceptLegalDocumentsDto } from './dto/accept-legal-documents.dto';
import { LegalService } from './legal.service';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';

type LegalRequest = SessionContextRequest & {
  user: { sub: string; actor_sub?: string; acting_for?: boolean };
};

@ApiTags('legal')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class LegalAcceptanceController {
  constructor(private readonly legalService: LegalService) {}

  /**
   * GET /api/v1/users/me/legal-acceptance
   * Acceptance status of the authenticated user for the CURRENT versions.
   */
  @Get('legal-acceptance')
  @ActingScope('self:read')
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @ApiOperation({ summary: 'Legal acceptance status of the current user' })
  @ApiResponse({ status: 200, description: 'LegalStatus block' })
  async getStatus(@Req() req: LegalRequest) {
    return {
      status: 'success',
      data: await this.legalService.getStatus(req.user.sub),
    };
  }

  /**
   * POST /api/v1/users/me/legal-acceptance
   * Accepts the current Terms and Privacy versions. Idempotent.
   */
  @Post('legal-acceptance')
  @ActingScope('legal:accept')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 10 }))
  @ApiOperation({ summary: 'Accept the current legal documents' })
  @ApiResponse({
    status: 200,
    description: 'LegalStatus block after accepting',
  })
  @ApiResponse({
    status: 400,
    description: 'LEGAL_VERSION_MISMATCH or validation error',
  })
  async accept(@Req() req: LegalRequest, @Body() dto: AcceptLegalDocumentsDto) {
    return {
      status: 'success',
      data: await this.legalService.accept(
        req.user.sub,
        { terms: dto.terms_version, privacy: dto.privacy_version },
        sessionContextFromRequest(req),
        // While a guardian acts for a dependent the subject is the child, but
        // the person who accepted is the guardian (legal evidence).
        req.user.acting_for ? req.user.actor_sub : null,
      ),
    };
  }
}
