import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
export declare class OAuthService {
    private readonly prisma;
    private readonly supabase;
    private readonly logger;
    constructor(prisma: PrismaService, supabase: SupabaseService);
    initiateGoogleSignIn(redirectUrl?: string): Promise<{
        url: string;
    }>;
    initiateAppleSignIn(redirectUrl?: string): Promise<{
        url: string;
    }>;
    handleCallback(dto: OAuthCallbackDto): Promise<{
        user: {
            id: string;
            email: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            avatar: string | null;
            google_connected: boolean;
            apple_connected: boolean;
        };
        needsPostRegistration: boolean;
        accessToken: string;
        refreshToken?: string | null;
        expiresAt?: number | null;
        tokenType?: string;
    }>;
    private createUserFromOAuth;
    getConnectedProviders(userId: string): Promise<{
        apple_connected: boolean;
        fb_connected: boolean;
        google_connected: boolean;
    }>;
    disconnectProvider(userId: string, provider: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
