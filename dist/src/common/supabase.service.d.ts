import { SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
export declare class SupabaseService {
    private configService;
    private supabaseAdmin;
    private supabaseAnon;
    constructor(configService: ConfigService);
    get admin(): SupabaseClient;
    get anon(): SupabaseClient;
}
