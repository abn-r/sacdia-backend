type JsonRow = Record<string, unknown>;

export interface AuthorizationP0PreflightCheck {
  id: string;
  total_count: number;
  rows: JsonRow[];
  sample_count: number;
  truncated: boolean;
}

export interface AuthorizationP0PreflightReport {
  schema: {
    director_succession_plans: string;
    [key: string]: unknown;
  };
  checks: AuthorizationP0PreflightCheck[];
}
