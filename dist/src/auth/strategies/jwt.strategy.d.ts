import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
export interface JwtPayload {
    sub: string;
    email: string;
    iat?: number;
    exp?: number;
}
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private configService;
    private readonly tokenBlacklistService;
    private readonly logger;
    constructor(configService: ConfigService, tokenBlacklistService: TokenBlacklistService);
    validate(req: Request, payload: JwtPayload): Promise<{
        sub: string;
        userId: string;
        user_id: string;
        email: string;
    }>;
    private extractToken;
}
export {};
