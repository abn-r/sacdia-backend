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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthorizationResource, RequirePermissions, GlobalRoles } from '../common/decorators';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminMfaStatusResponseDto,
  AdminSessionListResponseDto,
  AdminSetPasswordDto,
} from './dto/admin-auth.dto';

/**
 * AdminAuthController — Admin-scoped session, MFA, and password management.
 *
 * All endpoints operate on TARGET users (identified by :userId param),
 * not the currently authenticated admin. They are guarded by:
 *   - JwtAuthGuard          — valid SACDIA JWT required
 *   - GlobalRolesGuard      — admin or super_admin global role required
 *   - PermissionsGuard      — users:update permission required
 *
 * These guards are applied at the class level — identical to AdminUsersController.
 */
@ApiTags('admin-auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super_admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin/users/:userId')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  @Get('sessions')
  @RequirePermissions('users:update')
  @ApiOperation({
    summary: "List all active sessions for a user",
    description:
      'Returns all non-expired sessions for the target user. ' +
      'Requires admin or super_admin role.',
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
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; data: AdminSessionListResponseDto }> {
    const data = await this.adminAuthService.listUserSessions(userId);
    return { status: 'success', data };
  }

  @Delete('sessions/:sessionId')
  @RequirePermissions('users:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Revoke a specific session for a user",
    description:
      'Deletes a specific session token, forcing the device to re-authenticate. ' +
      'Requires admin or super_admin role.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiParam({ name: 'sessionId', type: String, description: 'Session ID to revoke' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 404, description: 'User or session not found' })
  async revokeUserSession(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ status: string; message: string }> {
    await this.adminAuthService.revokeUserSession(userId, sessionId);
    return {
      status: 'success',
      message: `Session ${sessionId} revoked for user ${userId}`,
    };
  }

  @Delete('sessions')
  @RequirePermissions('users:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Revoke all sessions for a user",
    description:
      'Deletes ALL sessions for the target user, forcing a complete re-authentication ' +
      'across all devices. Requires admin or super_admin role.',
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
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ status: string; data: { revokedCount: number } }> {
    const revokedCount = await this.adminAuthService.revokeAllUserSessions(userId);
    return { status: 'success', data: { revokedCount } };
  }

  // ---------------------------------------------------------------------------
  // MFA management
  // ---------------------------------------------------------------------------

  @Get('mfa/status')
  @RequirePermissions('users:update')
  @ApiOperation({
    summary: "Get MFA enrollment status for a user",
    description:
      'Returns whether the target user has TOTP 2FA enrolled. ' +
      'Requires admin or super_admin role.',
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
  @RequirePermissions('users:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset (disable) MFA for a user",
    description:
      'Disables TOTP 2FA for the target user without requiring their password. ' +
      'This is an admin override — the user will need to re-enroll 2FA after this. ' +
      'Requires admin or super_admin role.',
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
  @RequirePermissions('users:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set a new password for a user",
    description:
      "Updates the target user's password without requiring their current password. " +
      'This is an admin override. Revoke all sessions afterwards if immediate lockout is required. ' +
      'Requires admin or super_admin role.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'Target user UUID' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Validation error in request body' })
  @ApiResponse({ status: 404, description: 'User not found or has no credential account' })
  async setUserPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdminSetPasswordDto,
  ): Promise<{ status: string; message: string }> {
    await this.adminAuthService.setUserPassword(userId, dto.newPassword);
    return { status: 'success', message: `Password updated for user ${userId}` };
  }
}
