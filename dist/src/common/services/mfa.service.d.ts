export interface MfaEnrollResponse {
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
}
export interface MfaFactor {
    id: string;
    friendlyName: string;
    factorType: string;
    status: string;
    createdAt: string;
}
export declare class MfaService {
    private readonly logger;
    private supabase;
    constructor();
    enrollMfa(accessToken: string, refreshToken?: string): Promise<MfaEnrollResponse>;
    verifyAndActivateMfa(accessToken: string, factorId: string, code: string, refreshToken?: string): Promise<{
        verified: boolean;
    }>;
    verifyMfaCode(accessToken: string, factorId: string, code: string, refreshToken?: string): Promise<boolean>;
    listFactors(accessToken: string, refreshToken?: string): Promise<MfaFactor[]>;
    unenrollFactor(accessToken: string, factorId: string, refreshToken?: string): Promise<void>;
    hasMfaEnabled(accessToken: string, refreshToken?: string): Promise<boolean>;
    getAuthenticatorAssuranceLevel(accessToken: string, refreshToken?: string): Promise<{
        currentLevel: string;
        nextLevel: string | null;
    }>;
    private bindSession;
}
