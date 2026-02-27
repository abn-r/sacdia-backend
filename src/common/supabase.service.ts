import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseService {
  private supabaseAdmin: SupabaseClient;
  private supabaseAnon: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')!;
    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    )!;
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY')!;

    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Cliente con anon key para operaciones de sesión de usuario (refresh, etc.)
    this.supabaseAnon = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  get admin(): SupabaseClient {
    return this.supabaseAdmin;
  }

  get anon(): SupabaseClient {
    return this.supabaseAnon;
  }
}
