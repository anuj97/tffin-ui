import { HouseholdMemberRole } from './household.model';

export interface UserHouseholdMembership {
  household_id: string;
  role: HouseholdMemberRole;
}

export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  household_id?: string | null;
  household_ids?: string[];
  memberships?: UserHouseholdMembership[];
  email?: string;
  avatar_url?: string;
  phone?: string;
  dietary_preferences?: string;
  bio?: string;
  created_at?: string;
}
