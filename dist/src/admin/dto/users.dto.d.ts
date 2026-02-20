import { PaginationDto } from '../../common/dto/pagination.dto';
export declare class AdminListUsersQueryDto extends PaginationDto {
    search?: string;
    role?: string;
    active?: boolean;
    unionId?: number;
    localFieldId?: number;
    page?: number;
    limit?: number;
}
