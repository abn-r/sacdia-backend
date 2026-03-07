import { ActivitiesService } from './activities.service';
import { CreateActivityDto, UpdateActivityDto, RecordAttendanceDto } from './dto';
export declare class ActivitiesController {
    private readonly activitiesService;
    constructor(activitiesService: ActivitiesService);
    findByClub(clubId: number, clubTypeId?: number, active?: string, activityTypeId?: number, page?: number, limit?: number): Promise<import("../common/dto/pagination.dto").PaginatedResult<any>>;
    create(clubId: number, dto: CreateActivityDto, req: any): Promise<any>;
    findOne(activityId: number): Promise<any>;
    update(activityId: number, dto: UpdateActivityDto): Promise<any>;
    remove(activityId: number): Promise<{
        classes: import("@prisma/client/runtime/client").JsonValue | null;
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        activity_type_id: number;
        lat: number;
        activity_id: number;
        long: number;
        activity_time: string;
        activity_place: string;
        image: string;
        platform: number;
        link_meet: string | null;
        additional_data: string | null;
        attendees: import("@prisma/client/runtime/client").JsonValue | null;
        created_by: string;
    }>;
    recordAttendance(activityId: number, dto: RecordAttendanceDto): Promise<{
        classes: import("@prisma/client/runtime/client").JsonValue | null;
        name: string;
        active: boolean;
        created_at: Date | null;
        modified_at: Date | null;
        description: string | null;
        club_adv_id: number | null;
        club_pathf_id: number | null;
        club_mg_id: number | null;
        club_type_id: number;
        activity_type_id: number;
        lat: number;
        activity_id: number;
        long: number;
        activity_time: string;
        activity_place: string;
        image: string;
        platform: number;
        link_meet: string | null;
        additional_data: string | null;
        attendees: import("@prisma/client/runtime/client").JsonValue | null;
        created_by: string;
    }>;
    getAttendance(activityId: number): Promise<{
        activity_id: number;
        attendees: never[];
        activity_name?: undefined;
        total_attendees?: undefined;
    } | {
        activity_id: number;
        activity_name: any;
        total_attendees: number;
        attendees: {
            user_image: string | null;
            user_id: string;
            name: string | null;
            paternal_last_name: string | null;
            maternal_last_name: string | null;
        }[];
    }>;
}
