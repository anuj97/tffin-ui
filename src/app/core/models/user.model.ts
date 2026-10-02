export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  household_id?: string | null;
  household_ids?: string[];
  email?: string;
  avatar_url?: string;
  phone?: string;
  dietary_preferences?: string;
  bio?: string;
  created_at?: string;
}
