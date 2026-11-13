import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';
import type { AuthPrincipal } from '../auth/acting-for/auth-principal';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { SetReleaseEmailDto } from './dto';
import { ReleaseService } from './release.service';

/**
 * Self-service of a released adult (Phase 4). The route declares the
 * `release:email` scope that ONLY the `released_user` principal holds, so a
 * guardian acting, a teen, a device or an ordinary adult are refused by the
 * acting-scope policy. Ownership is the token's own subject, hence
 * `@SkipPermissions`.
 */
@ApiTags('guardianships')
@Controller('users/me/release')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class ReleaseController {
  constructor(private readonly release: ReleaseService) {}

  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ActingScope('release:email')
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 5 }))
  @ApiOperation({
    summary: 'A released adult without an email adds one',
    description:
      'Stores the email (unverified: it is enough to complete the release, ruling R5), sends the verification mail and, when the fresh terms were already accepted, completes the release (thawing a majority freeze). Works while frozen.',
  })
  @ApiResponse({
    status: 200,
    description: '{ status: "success", data: { completed, thawed } }',
  })
  @ApiResponse({ status: 403, description: 'PRINCIPAL_SCOPE_DENIED' })
  @ApiResponse({
    status: 409,
    description:
      'FAMILY_RELEASE_EMAIL_ALREADY_SET or FAMILY_RELEASE_EMAIL_UNAVAILABLE',
  })
  @ApiResponse({ status: 429, description: '5 per hour' })
  async setEmail(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: SetReleaseEmailDto,
  ) {
    return {
      status: 'success',
      data: await this.release.setEmail(user.sub, dto.email),
    };
  }
}
