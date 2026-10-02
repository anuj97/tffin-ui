import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { AppUser } from '../models/user.model';
import { MOCK_USERS } from '../mock/mock-data';

const STORAGE_KEY = 'tffin_auth_user';
const DEBUG_FLAG_KEY = 'tffin_is_debug_mode';

export const LOCAL_DEBUG_USER: AppUser = {
  id: 'local-debug-admin-01',
  username: 'debug_admin',
  fullName: 'Local Debug Admin',
  role: 'admin',
  household_ids: [] // unrestricted
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  public currentUser = signal<AppUser | null>(this.loadStoredUser());
  public isAuthenticated = computed(() => !!this.currentUser());
  public isAuthenticating = signal<boolean>(false);
  public isLocalDebug = signal<boolean>(this.checkIfLocalDebug());

  private checkIfLocalDebug(): boolean {
    return localStorage.getItem(DEBUG_FLAG_KEY) === 'true' || sessionStorage.getItem(DEBUG_FLAG_KEY) === 'true';
  }

  private loadStoredUser(): AppUser | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as AppUser;
      }
    } catch (e) {
      console.warn('Failed to parse cached auth session:', e);
    }
    return null;
  }

  public loginLocalDebug(personaKey: string = 'admin'): { success: boolean } {
    const matched = MOCK_USERS[personaKey] || MOCK_USERS['admin'];
    const user: AppUser = {
      ...matched
    };

    this.currentUser.set(user);
    this.isLocalDebug.set(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(DEBUG_FLAG_KEY, 'true');
    return { success: true };
  }

  public async login(
    username: string,
    password: string,
    rememberMe: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    this.isAuthenticating.set(true);

    // If Supabase client is not configured, support local offline fallback
    if (!this.supabase.hasClient) {
      this.isAuthenticating.set(false);
      const cleanUser = username.trim().toLowerCase();

      if ((cleanUser === 'admin' && password === 'admin123') || cleanUser === 'debug') {
        return this.loginLocalDebug('admin');
      }
      if (cleanUser === 'verma' || cleanUser === 'amit_verma') {
        return this.loginLocalDebug('verma');
      }
      if (cleanUser === 'priya' || cleanUser === 'priya_patel') {
        return this.loginLocalDebug('priya');
      }
      if (cleanUser === 'chef' || cleanUser === 'chef_rajesh') {
        return this.loginLocalDebug('chef');
      }

      return {
        success: false,
        error: 'Supabase credentials are not configured. Click one of the test persona buttons below or sign in with admin / admin123.'
      };
    }

    try {
      const user = await this.supabase.verifyUserCredentials(username, password);
      this.isAuthenticating.set(false);

      if (!user) {
        return {
          success: false,
          error: 'Invalid username or password. Please try again.'
        };
      }

      this.currentUser.set(user);
      this.isLocalDebug.set(false);
      localStorage.removeItem(DEBUG_FLAG_KEY);

      // Persist session
      const userJson = JSON.stringify(user);
      if (rememberMe) {
        localStorage.setItem(STORAGE_KEY, userJson);
      } else {
        sessionStorage.setItem(STORAGE_KEY, userJson);
      }

      return { success: true };
    } catch (err: any) {
      this.isAuthenticating.set(false);
      return {
        success: false,
        error: err.message || 'Connection error while contacting authentication service.'
      };
    }
  }

  public logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEBUG_FLAG_KEY);
    sessionStorage.removeItem(DEBUG_FLAG_KEY);
    this.currentUser.set(null);
    this.isLocalDebug.set(false);
    this.router.navigate(['/login']);
  }
}
