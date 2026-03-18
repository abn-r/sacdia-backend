import { AdminListUsersQueryDto } from './dto';
import { AdminUsersService } from './admin-users.service';
export declare class AdminUsersController {
    private readonly adminUsersService;
    constructor(adminUsersService: AdminUsersService);
    listUsers(req: any, query: AdminListUsersQueryDto): Promise<{
        status: string;
        data: any;
    }>;
    getUserById(req: any, userId: string): Promise<{
        status: string;
        data: any;
    }>;
}
