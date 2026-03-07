import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import type { FileStorageService } from '../common/services/file-storage.service';
type RefreshSessionContext = {
    userAgent?: string;
};
export type LogoutRequest = {
    accessToken?: string;
    refreshToken?: string;
    userAgent?: string;
};
type LogoutPath = 'access' | 'refresh' | 'none';
export declare class AuthService {
    private prisma;
    private supabase;
    private readonly authorizationContext;
    private readonly fileStorage;
    private readonly logger;
    private static readonly PRIVATE_ASSET_URL_TTL_SECONDS;
    constructor(prisma: PrismaService, supabase: SupabaseService, authorizationContext: AuthorizationContextService, fileStorage: FileStorageService);
    register(dto: RegisterDto): Promise<{
        success: boolean;
        userId: string;
        message: string;
    }>;
    login(dto: LoginDto): Promise<{
        status: string;
        data: {
            user: {
                id: string;
                email: string;
                name: string | null;
                paternal_last_name: string | null;
                maternal_last_name: string | null;
                avatar: string | null;
                roles: string[];
            };
            needsPostRegistration: boolean;
            postRegistrationStatus: {
                complete: boolean;
                profile_picture_complete: boolean;
                personal_info_complete: boolean;
                club_selection_complete: boolean;
            };
            accessToken: string;
            refreshToken?: string | null;
            expiresAt?: number | null;
            tokenType?: string;
        };
    }>;
    refreshSession(dto: RefreshSessionDto, context?: RefreshSessionContext): Promise<{
        status: string;
        data: import("./utils/auth-token-response.util").AuthTokenResponse;
    }>;
    logout(input?: LogoutRequest): Promise<{
        success: boolean;
        message: string;
        revocationAttempted: boolean;
        revocationSucceeded: boolean;
        path: LogoutPath;
    }>;
    requestPasswordReset(dto: ResetPasswordRequestDto): Promise<{
        success: boolean;
        message: string;
    }>;
    getProfile(userId: string): Promise<{
        status: string;
        data: {
            user_image: string | null;
            roles: string[];
            permissions: string[];
            post_register_complete: boolean;
            club: {
                club_id: number;
                club_name: string;
                club_type: string | null;
            } | null;
            club_context: {
                active_assignment_id: string | null;
                active: import("../common/services/authorization-context.service").LegacyAssignmentContext | null;
                available: import("../common/services/authorization-context.service").LegacyAssignmentContext[];
            };
            authorization: import("../common/services/authorization-context.service").AuthorizationSnapshot;
            user_id: string;
            email: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            gender: string | null;
            birthday: Date | null;
            baptism: boolean;
            baptism_date: Date | null;
            country_id: number | null;
            union_id: number | null;
            local_field_id: number | null;
            created_at: Date;
        };
    }>;
    setActiveClubContext(userId: string, dto: SetActiveClubContextDto): Promise<{
        status: string;
        data: {
            active_assignment_id: string | null;
            club: {
                club_id: number;
                club_name: string;
                club_type: string | null;
            } | null;
            active: import("../common/services/authorization-context.service").LegacyAssignmentContext | null;
            authorization: import("../common/services/authorization-context.service").AuthorizationSnapshot;
        };
    }>;
    getCompletionStatus(userId: string): Promise<{
        status: string;
        data: {
            complete: boolean;
            steps: {
                profilePicture: boolean;
                personalInfo: boolean;
                clubSelection: boolean;
            };
            nextStep: string | null;
            dateCompleted: Date | null;
        };
    }>;
    private getAccessTokenForLogout;
    private normalizeToken;
    private resolvePrivateProfilePicture;
    private shouldRejectSnakeCase;
    private maskEmail;
}
export {};
