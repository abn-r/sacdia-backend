import { FoldersService } from './folders.service';
import { UpdateSectionRecordDto } from './dto/update-section-record.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
export declare class FoldersController {
    private readonly foldersService;
    constructor(foldersService: FoldersService);
    findAll(clubTypeId?: number, paginationDto?: PaginationDto): Promise<{
        status: string;
        data: any[];
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
        };
    }>;
    findOne(id: number): Promise<{
        status: string;
        data: {
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
        };
    }>;
    enrollUser(userId: string, folderId: number): Promise<{
        status: string;
        data: {
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
        };
    }>;
    getUserFolders(userId: string): Promise<{
        status: string;
        data: {
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
        }[];
    }>;
    getFolderProgress(userId: string, folderId: number): Promise<{
        status: string;
        data: {
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
        };
    }>;
    updateSectionProgress(userId: string, folderId: number, moduleId: number, sectionId: number, dto: UpdateSectionRecordDto): Promise<{
        status: string;
        data: {
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
        };
    }>;
    deleteAssignment(userId: string, folderId: number): Promise<{
        message: string;
        status: string;
    }>;
}
