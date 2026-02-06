import { OAuthService } from './oauth.service';
import { OAuthInitiateDto } from './dto/oauth-initiate.dto';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
export declare class OAuthController {
    private readonly oauthService;
    constructor(oauthService: OAuthService);
    googleSignIn(dto: OAuthInitiateDto): Promise<{
        url: string;
    }>;
    appleSignIn(dto: OAuthInitiateDto): Promise<{
        url: string;
    }>;
    handleCallback(query: OAuthCallbackDto): Promise<{
        access_token: string;
        refresh_token: string | undefined;
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
    }>;
    getConnectedProviders(req: any): Promise<{
        apple_connected: boolean;
        fb_connected: boolean;
        google_connected: boolean;
    }>;
    disconnectProvider(provider: string, req: any): Promise<{
        success: boolean;
        message: string;
    }>;
}
