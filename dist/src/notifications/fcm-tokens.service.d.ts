import { PrismaService } from '../prisma/prisma.service';
export interface RegisterFcmTokenDto {
    token: string;
    device_type?: string;
    device_name?: string;
}
export declare class FcmTokensService {
    private prisma;
    constructor(prisma: PrismaService);
    registerToken(userId: string, dto: RegisterFcmTokenDto): Promise<{
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
    unregisterToken(token: string, userId: string): Promise<{
        success: boolean;
        message: string;
    }>;
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
    cleanupOldTokens(): Promise<{
        deletedCount: number;
    }>;
}
