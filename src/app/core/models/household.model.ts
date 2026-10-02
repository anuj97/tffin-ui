export interface Household {
  id: string;
  name: string;
  code?: string;
  contact_name?: string;
  contact_phone?: string;
  address?: string;
  default_headcount: number;
  dietary_notes?: string;
  color_tag?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type HouseholdMemberRole = 'owner' | 'member' | 'viewer';

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string;
  role_in_household: HouseholdMemberRole;
  created_at?: string;
  username?: string;
  fullName?: string;
  email?: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface HouseholdInvitation {
  id: string;
  household_id: string;
  invited_by?: string;
  invite_code: string;
  email?: string;
  role_in_household: HouseholdMemberRole;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  accepted_at?: string;
  accepted_by?: string;
  household_name?: string;
}
