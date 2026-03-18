import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { LogoutDto } from './dto/logout.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(registerDto: RegisterDto): Promise<{
        success: boolean;
        userId: string;
        message: string;
    }>;
    login(loginDto: LoginDto): Promise<{
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
    refresh(dto: RefreshSessionDto, userAgent?: string): Promise<{
        status: string;
        data: import("./utils/auth-token-response.util").AuthTokenResponse;
    }>;
    logout(authorization?: string, dto?: LogoutDto, userAgent?: string): Promise<{
        success: boolean;
        message: string;
        revocationAttempted: boolean;
        revocationSucceeded: boolean;
        path: "access" | "refresh" | "none";
    }>;
    requestPasswordReset(dto: ResetPasswordRequestDto): Promise<{
        success: boolean;
        message: string;
    }>;
    getProfile(user: {
        userId: string;
    }): Promise<{
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
                active: import("../common/services").LegacyAssignmentContext | null;
                available: import("../common/services").LegacyAssignmentContext[];
            };
            authorization: import("../common/services").AuthorizationSnapshot;
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
    setActiveContext(user: {
        userId: string;
    }, dto: SetActiveClubContextDto): Promise<{
        status: string;
        data: {
            active_assignment_id: string | null;
            club: {
                club_id: number;
                club_name: string;
                club_type: string | null;
            } | null;
            active: import("../common/services").LegacyAssignmentContext | null;
            authorization: import("../common/services").AuthorizationSnapshot;
        };
    }>;
    getCompletionStatus(user: {
        userId: string;
    }): Promise<{
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
    private extractBearerToken;
}
