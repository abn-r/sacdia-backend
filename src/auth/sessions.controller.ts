import {
  Controller,
  Get,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../config/throttler.helpers';
import { SessionsService } from './sessions.service';
import {
  SessionListResponseDto,
  RevokeAllSessionsResponseDto,
} from './dto/session-response.dto';

/**
 * SessionsController — Active session management.
 *
 * All endpoints require a valid SACDIA HS256 JWT (JwtAuthGuard).
 *
 * The `sid` claim embedded in the JWT (present for tokens issued from 2026-04
 * onwards) identifies the caller's current BA session row. Endpoints use this
 * claim to populate `is_current` and to guard against self-revocation.
 *
 * Rate limits:
 *   GET  /auth/sessions          — 30 requests / 60 s / user
 *   DELETE /auth/sessions/:id    — 10 requests / 60 s / user
 *   DELETE /auth/sessions        — 10 requests / 60 s / user
 */
@ApiTags('auth')
@Controller('auth/sessions')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // ---------------------------------------------------------------------------
  // GET /auth/sessions
  // ---------------------------------------------------------------------------

  @Get()
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @ApiOperation({
    summary: 'List active sessions',
    description:
      'Returns all non-expired BA sessions for the authenticated user. ' +
      'The `is_current` field is true for the session matching the `sid` claim in the JWT.',
  })
  @ApiResponse({
    status: 200,
    description: 'Active sessions list',
    type: SessionListResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or expired JWT',
  })
  async listSessions(@Req() req: Request): Promise<SessionListResponseDto> {
    const user = req.user as any;
    return this.sessionsService.listSessions(user.user_id, user.sid ?? null);
  }

  // ---------------------------------------------------------------------------
  // DELETE /auth/sessions/:sessionId
  // ---------------------------------------------------------------------------

  @Delete(':sessionId')
  @Throttle(namedThrottle({ ttl: 60000, limit: 10 }))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a specific session',
    description:
      'Deletes the specified BA session from the database. ' +
      "Returns 400 when the sessionId matches the caller's current session — use POST /auth/logout instead. " +
      'Returns 403 when the session belongs to a different user. ' +
      'Returns 404 when the session does not exist or has already expired.',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'UUID of the BA session to revoke',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({ status: 204, description: 'Session revoked successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot revoke current session — use logout instead',
  })
  @ApiResponse({
    status: 403,
    description: 'Session belongs to a different user',
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found or already expired',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or expired JWT',
  })
  async revokeSession(
    @Req() req: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    const user = req.user as any;
    await this.sessionsService.revokeSession(
      user.user_id,
      user.sid ?? null,
      sessionId,
    );
  }

  // ---------------------------------------------------------------------------
  // DELETE /auth/sessions
  // ---------------------------------------------------------------------------

  @Delete()
  @Throttle(namedThrottle({ ttl: 60000, limit: 10 }))
  @ApiOperation({
    summary: 'Revoke all other sessions',
    description:
      'Revokes all active BA sessions for the authenticated user except the current one. ' +
      'When the JWT has no `sid` claim (legacy tokens issued before 2026-04), all sessions ' +
      'including the current one are revoked and the caller must re-authenticate.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessions revoked',
    type: RevokeAllSessionsResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or expired JWT',
  })
  async revokeAllSessions(
    @Req() req: Request,
  ): Promise<RevokeAllSessionsResponseDto> {
    const user = req.user as any;
    return this.sessionsService.revokeAllOtherSessions(
      user.user_id,
      user.sid ?? null,
    );
  }
}
