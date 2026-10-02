export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  household_id?: string | null;
}
