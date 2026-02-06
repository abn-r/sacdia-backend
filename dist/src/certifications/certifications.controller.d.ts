import { CertificationsService } from './certifications.service';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
export declare class CertificationsController {
    private readonly certificationsService;
    constructor(certificationsService: CertificationsService);
    findAll(paginationDto: PaginationDto): Promise<{
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
        };
    }>;
    enrollUser(userId: string, dto: EnrollCertificationDto): Promise<{
        status: string;
        data: {
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
        };
    }>;
    getUserCertifications(userId: string): Promise<{
        status: string;
        data: {
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
        }[];
    }>;
    getCertificationProgress(userId: string, certificationId: number): Promise<{
        status: string;
        data: {
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
        };
    }>;
    updateProgress(userId: string, certificationId: number, dto: UpdateProgressDto): Promise<{
        status: string;
        data: {
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
        };
    }>;
    deleteCertification(userId: string, certificationId: number): Promise<{
        message: string;
        status: string;
    }>;
}
