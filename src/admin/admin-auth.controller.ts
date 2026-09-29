import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
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
  GlobalRoles,
} from '../common/decorators';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';
import { AdminAuthService } from './admin-auth.service';
import { USER_MANAGEMENT_ROLES } from './admin-users.controller';
import {
  AdminMfaStatusResponseDto,
  AdminSessionListResponseDto,
  AdminSetPasswordDto,
} from './dto/admin-auth.dto';

/**
 * AdminAuthController — Admin-scoped session, MFA, and password management.
 *
 * Session list/revoke override the class-level admin fence with
 * USER_MANAGEMENT_ROLES + users:read_detail (same as GET /admin/users/:id).
 * MFA and password stay admin / super-admin + users:update_admin.
 */
@ApiTags('admin-auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super-admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin/users/:userId')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  private getActorId(
    request: ExpressRequest & { user: { sub: string } },
  ): string {
    return request.user.sub;
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  @Get('sessions')
  @GlobalRoles(...USER_MANAGEMENT_ROLES)
  @RequirePermissions('users:read_detail')
  @ApiOperation({
    summary: 'List all active sessions for a user',
    description:
      'Returns all non-expired sessions for the target user. ' +
      'Same roles as GET /admin/users/:userId; scoped to the actor territory.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({
    status: 200,
    description: 'Active sessions list',
    type: AdminSessionListResponseDto,
    schema: {
      properties: {
        status: { type: 'string', example: 'success' },
        data: { $ref: '#/components/schemas/AdminSessionListResponseDto' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listUserSessions(
    @Request() request: ExpressRequest & { user: { sub: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; data: AdminSessionListResponseDto }> {
    const data = await this.adminAuthService.listUserSessions(
      this.getActorId(request),
      userId,
    );
    return { status: 'success', data };
  }

  @Delete('sessions/:sessionId')
  @GlobalRoles(...USER_MANAGEMENT_ROLES)
  @RequirePermissions('users:read_detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a specific session for a user',
    description:
      'Deletes a specific session token, forcing the device to re-authenticate. ' +
      'Same roles as GET /admin/users/:userId; scoped to the actor territory.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiParam({
    name: 'sessionId',
    type: String,
    description: 'Session ID to revoke',
  })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 404, description: 'User or session not found' })
  async revokeUserSession(
    @Request() request: ExpressRequest & { user: { sub: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ status: string; message: string }> {
    await this.adminAuthService.revokeUserSession(
      this.getActorId(request),
      userId,
      sessionId,
    );
    return {
      status: 'success',
      message: `Session ${sessionId} revoked for user ${userId}`,
    };
  }

  @Delete('sessions')
  @GlobalRoles(...USER_MANAGEMENT_ROLES)
  @RequirePermissions('users:read_detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke all sessions for a user',
    description:
      'Deletes ALL sessions for the target user, forcing a complete re-authentication ' +
      'across all devices. Same roles as GET /admin/users/:userId; scoped to the actor territory.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({
    status: 200,
    description: 'All sessions revoked',
    schema: {
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          properties: {
            revokedCount: { type: 'number', example: 3 },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async revokeAllUserSessions(
    @Request() request: ExpressRequest & { user: { sub: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; data: { revokedCount: number } }> {
    const revokedCount = await this.adminAuthService.revokeAllUserSessions(
      this.getActorId(request),
      userId,
    );
    return { status: 'success', data: { revokedCount } };
  }

  // ---------------------------------------------------------------------------
  // MFA management
  // ---------------------------------------------------------------------------

  @Get('mfa/status')
  @RequirePermissions('users:update_admin')
  @ApiOperation({
    summary: 'Get MFA enrollment status for a user',
    description:
      'Returns whether the target user has TOTP 2FA enrolled. ' +
      'Requires admin or super-admin role.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({
    status: 200,
    description: 'MFA status',
    type: AdminMfaStatusResponseDto,
    schema: {
      properties: {
        status: { type: 'string', example: 'success' },
        data: { $ref: '#/components/schemas/AdminMfaStatusResponseDto' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserMfaStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; data: AdminMfaStatusResponseDto }> {
    const data = await this.adminAuthService.getUserMfaStatus(userId);
    return { status: 'success', data };
  }

  @Delete('mfa')
  @RequirePermissions('users:update_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset (disable) MFA for a user',
    description:
      'Disables TOTP 2FA for the target user without requiring their password. ' +
      'This is an admin override — the user will need to re-enroll 2FA after this. ' +
      'Requires admin or super-admin role.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({ status: 200, description: 'MFA disabled' })
  @ApiResponse({ status: 400, description: 'MFA is not enabled for this user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resetUserMfa(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; message: string }> {
    await this.adminAuthService.resetUserMfa(userId);
    return { status: 'success', message: `MFA disabled for user ${userId}` };
  }

  // ---------------------------------------------------------------------------
  // Password management
  // ---------------------------------------------------------------------------

  @Post('password')
  @RequirePermissions('users:update_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password for a user',
    description:
      "Updates the target user's password without requiring their current password. " +
      'This is an admin override. Revoke all sessions afterwards if immediate lockout is required. ' +
      'Requires admin or super-admin role.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Validation error in request body' })
  @ApiResponse({
    status: 404,
    description: 'User not found or has no credential account',
  })
  async setUserPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdminSetPasswordDto,
  ): Promise<{ status: string; message: string }> {
    await this.adminAuthService.setUserPassword(userId, dto.newPassword);
    return {
      status: 'success',
      message: `Password updated for user ${userId}`,
    };
  }
}
