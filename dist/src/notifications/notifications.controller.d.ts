import { NotificationsService } from './notifications.service';
import { FcmTokensService } from './fcm-tokens.service';
declare class SendNotificationDto {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
}
declare class BroadcastNotificationDto {
    title: string;
    body: string;
    data?: Record<string, string>;
}
declare class RegisterFcmTokenDto {
    token: string;
    device_type?: string;
    device_name?: string;
}
export declare class NotificationsController {
    private notificationsService;
    private fcmTokensService;
    constructor(notificationsService: NotificationsService, fcmTokensService: FcmTokensService);
    sendToUser(dto: SendNotificationDto): Promise<{
        success: boolean;
        message: string;
        successCount?: undefined;
        failureCount?: undefined;
    } | {
        success: boolean;
        successCount: number;
        failureCount: number;
        message?: undefined;
    }>;
    broadcast(dto: BroadcastNotificationDto): Promise<{
        success: boolean;
        message: string;
        successCount?: undefined;
        failureCount?: undefined;
    } | {
        success: boolean;
        successCount: number;
        failureCount: number;
        message?: undefined;
    }>;
    sendToClub(instanceType: 'adventurers' | 'pathfinders' | 'master_guilds', instanceId: string, dto: BroadcastNotificationDto): Promise<{
        success: boolean;
        message: string;
        successCount?: undefined;
        failureCount?: undefined;
        memberCount?: undefined;
    } | {
        success: boolean;
        successCount: number;
        failureCount: number;
        memberCount: number;
        message?: undefined;
    }>;
}
export declare class FcmTokensController {
    private fcmTokensService;
    constructor(fcmTokensService: FcmTokensService);
    registerToken(dto: RegisterFcmTokenDto, req: any): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        fcm_token_id: string;
        token: string;
        device_type: string | null;
        device_name: string | null;
        last_used: Date;
    }>;
    unregisterToken(token: string, req: any): Promise<{
        success: boolean;
        message: string;
    }>;
    getMyTokens(req: any): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        fcm_token_id: string;
        token: string;
        device_type: string | null;
        device_name: string | null;
        last_used: Date;
    }[]>;
    getUserTokens(userId: string): Promise<{
        user_id: string;
        active: boolean;
        created_at: Date;
        modified_at: Date;
        fcm_token_id: string;
        token: string;
        device_type: string | null;
        device_name: string | null;
        last_used: Date;
    }[]>;
}
export {};
