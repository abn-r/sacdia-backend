import type {
  ConsentStatus,
  DependentOutcome,
} from './guardianships.constants';

export interface DependentClubMembership {
  assignment_id: string;
  status: 'pending' | 'active' | 'rejected' | 'expired' | 'cancelled';
  club_section_id: number;
  club_name: string | null;
  club_type_name: string | null;
}

export interface DependentSummary {
  user_id: string;
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
  birthday: string | null;
  age: number | null;
  user_image: string | null;
  access_mode: 'guardian_managed';
  post_register_complete: boolean;
  frozen: boolean;
  guardianship: {
    guardianship_id: string;
    is_primary: boolean;
    relationship_type: {
      relationship_type_id: string;
      name: string;
    } | null;
    consent_status: Exclude<ConsentStatus, 'revoked'>;
    verified_at: string | null;
    evidence_uploaded: boolean;
  };
  club_membership: DependentClubMembership | null;
}

export interface DependentGuardianEntry {
  guardianship_id: string;
  user_id: string | null;
  display_name: string;
  relationship_type_name: string | null;
  is_primary: boolean;
  is_custodian: boolean;
  consent_status: Exclude<ConsentStatus, 'revoked'>;
  is_me: boolean;
}

export interface DependentDetail extends DependentSummary {
  guardians: DependentGuardianEntry[];
}

export interface DeletionImpactEntry {
  user_id: string;
  display_name: string;
  outcome: DependentOutcome;
}
