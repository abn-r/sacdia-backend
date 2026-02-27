import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
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
            accessToken: string;
            refreshToken: string;
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
        };
    }>;
    refresh(dto: RefreshSessionDto): Promise<{
        status: string;
        data: {
            accessToken: string;
            refreshToken: string;
            expiresAt: number | null;
            tokenType: "bearer";
        };
    }>;
    logout(authorization: string): Promise<{
        success: boolean;
        message: string;
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
            roles: string[];
            permissions: string[];
            post_register_complete: boolean;
            club: {
                club_id: number;
                club_name: string;
                club_type: string;
            } | null;
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
            email: string;
            gender: string | null;
            birthday: Date | null;
            baptism: boolean;
            baptism_date: Date | null;
            user_image: string | null;
            created_at: Date;
            country_id: number | null;
            union_id: number | null;
            local_field_id: number | null;
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
}
