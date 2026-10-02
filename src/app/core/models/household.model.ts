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
