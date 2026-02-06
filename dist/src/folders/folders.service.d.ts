import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
import { UpdateSectionRecordDto } from './dto/update-section-record.dto';
export declare class FoldersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(clubTypeId?: number, pagination?: PaginationDto): Promise<PaginatedResult<any>>;
    findOne(folderId: number): Promise<{
        folder_id: number;
        name: string;
        description: string | null;
        club_type: number | null;
        ecclesiastical_year_id: number | null;
        max_points: number | null;
        minimum_points: number | null;
        active: boolean;
        modules: {
            module_id: number;
            name: string;
            description: string | null;
            max_points: number | null;
            minimum_points: number | null;
            sections: {
                section_id: number;
                name: string;
                description: string | null;
                max_points: number | null;
                minimum_points: number | null;
            }[];
        }[];
    }>;
    enrollUser(userId: string, folderId: number): Promise<{
        status: string | null;
        created_at: Date;
        user_id: string | null;
        active: boolean;
        modified_at: Date | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        completion_date: Date | null;
        progress_percentage: number | null;
        folder_id: number | null;
        total_points: number | null;
        folder_assignment_id: number;
        assignment_date: Date | null;
    }>;
    private getUserClubInstances;
    getUserFolders(userId: string): Promise<{
        assignment_id: number;
        folder_id: number | null;
        folder: {
            name: string | undefined;
            description: string | null | undefined;
            max_points: number | null | undefined;
            minimum_points: number | null | undefined;
        };
        status: string | null;
        total_points: number | null;
        progress_percentage: number | null;
        assigned_date: Date | null;
        completion_date: Date | null;
        active: boolean;
    }[]>;
    getFolderProgress(userId: string, folderId: number): Promise<{
        folder_id: number | null;
        folder_name: string | undefined;
        status: string | null;
        progress_percentage: number | null;
        total_points: number | null;
        max_points: number | null | undefined;
        minimum_points: number | null | undefined;
        assigned_date: Date | null;
        completion_date: Date | null;
        modules: {
            module_id: number;
            name: string;
            max_points: number | null;
            earned_points: number;
            progress_percentage: number;
            sections: {
                section_id: number;
                name: string;
                max_points: number | null;
                earned_points: number;
                evidences: string | number | boolean | import("@prisma/client/runtime/client").JsonObject | import("@prisma/client/runtime/client").JsonArray | null;
            }[];
        }[];
    }>;
    updateSectionProgress(userId: string, folderId: number, moduleId: number, sectionId: number, dto: UpdateSectionRecordDto): Promise<{
        section_record_id: any;
        folder_id: number;
        module_id: number;
        section_id: number;
        points: any;
        evidences: any;
        folder_progress: {
            total_points: number;
            progress_percentage: number;
            status: string;
        };
    }>;
    deleteAssignment(userId: string, folderId: number): Promise<{
        message: string;
    }>;
}
