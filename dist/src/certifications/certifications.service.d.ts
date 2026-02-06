import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto, PaginatedResult } from '../common/dto/pagination.dto';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
export declare class CertificationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(pagination?: PaginationDto): Promise<PaginatedResult<any>>;
    findOne(certificationId: number): Promise<{
        certification_id: number;
        name: string;
        description: string | null;
        active: boolean;
        modules: {
            module_id: number;
            name: string;
            description: string | null;
            sections: {
                section_id: number;
                name: string;
                description: string | null;
            }[];
        }[];
    }>;
    enrollUser(userId: string, dto: EnrollCertificationDto): Promise<{
        enrollment_id: number;
        user_id: string;
        certification_id: number;
        enrollment_date: Date;
        completion_status: boolean;
        completion_date: Date | null;
        active: boolean;
        certification: {
            name: string;
        };
    }>;
    private validateEligibility;
    getUserCertifications(userId: string): Promise<{
        enrollment_id: number;
        certification_id: number;
        certification: {
            name: string;
        };
        enrollment_date: Date;
        completion_status: boolean;
        progress_percentage: number;
        modules_completed: number;
        modules_total: number;
        active: boolean;
    }[]>;
    getCertificationProgress(userId: string, certificationId: number): Promise<{
        enrollment_id: number;
        certification_id: number;
        certification_name: string;
        progress_percentage: number;
        completion_status: boolean;
        enrollment_date: Date;
        modules: {
            module_id: number;
            name: string;
            completed: boolean;
            completion_date: Date | null;
            sections: {
                section_id: number;
                name: string;
                completed: boolean;
                completion_date: Date | null;
            }[];
        }[];
    }>;
    updateProgress(userId: string, certificationId: number, dto: UpdateProgressDto): Promise<{
        section_progress_id: any;
        module_id: number;
        section_id: number;
        completed: any;
        completion_date: any;
        module_progress: {
            module_id: any;
            completed: any;
            completion_date: any;
        };
        certification_progress: {
            progress_percentage: number;
            completion_status: boolean;
        };
    }>;
    deleteCertification(userId: string, certificationId: number): Promise<{
        message: string;
    }>;
}
