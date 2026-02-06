import { PrismaService } from '../prisma/prisma.service';
export interface SendNotificationDto {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
}
export interface BroadcastNotificationDto {
    title: string;
    body: string;
    data?: Record<string, string>;
}
export declare class NotificationsService {
    private prisma;
    constructor(prisma: PrismaService);
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
    sendToClubMembers(clubInstanceId: number, instanceType: 'adventurers' | 'pathfinders' | 'master_guilds', dto: Omit<BroadcastNotificationDto, 'userId'>): Promise<{
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
    private chunkArray;
}
