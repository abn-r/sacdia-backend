import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LegalRepresentativesService } from '../legal-representatives/legal-representatives.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';
export type PostRegistrationActorContext = {
    actorUserId: string;
    isOwner: boolean;
};
export declare class PostRegistrationService {
    private prisma;
    private usersService;
    private legalRepService;
    private readonly logger;
    constructor(prisma: PrismaService, usersService: UsersService, legalRepService: LegalRepresentativesService);
    getStatus(userId: string, actor?: PostRegistrationActorContext): Promise<{
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
    completeStep1(userId: string, actor?: PostRegistrationActorContext): Promise<{
        status: string;
        message: string;
    }>;
    completeStep2(userId: string, actor?: PostRegistrationActorContext): Promise<{
        status: string;
        message: string;
    }>;
    completeStep3(userId: string, dto: CompleteClubSelectionDto, actor?: PostRegistrationActorContext): Promise<{
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
    private createOwnerContext;
    private sanitizeAdministrativeValidationError;
}
