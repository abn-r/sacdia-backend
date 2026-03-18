import type { Request } from 'express';
import { PostRegistrationService } from './post-registration.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';
type AuthenticatedRequest = Request & {
    user?: {
        sub?: string;
    };
};
export declare class PostRegistrationController {
    private readonly postRegistrationService;
    constructor(postRegistrationService: PostRegistrationService);
    private buildActorContext;
    getStatus(userId: string, request: AuthenticatedRequest): Promise<{
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
    } | {
        status: string;
        data: {
            complete: boolean;
            steps: {
                profilePicture: boolean;
                personalInfo: boolean;
                clubSelection: boolean;
            };
            dateCompleted: Date | null;
        };
    }>;
    completeStep1(userId: string, request: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
    }>;
    completeStep2(userId: string, request: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
    }>;
    completeStep3(userId: string, dto: CompleteClubSelectionDto, request: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
        data: {
            clubType: "adventurers" | "pathfinders" | "master_guild";
            clubId: number;
            classId: number;
            ecclesiasticalYear: number;
        };
    } | {
        status: string;
        message: string;
    }>;
}
export {};
