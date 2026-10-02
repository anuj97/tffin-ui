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

  constructor() {
    this.initSupabaseAuthListener();
  }

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

  private initSupabaseAuthListener(): void {
    const client = this.supabase.clientInstance;
    if (!client) return;

    client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
        if (session?.user) {
          // If we are currently in local debug mode without OAuth redirect tokens, don't override
          const hasOAuthTokens =
            typeof window !== 'undefined' &&
            (window.location.hash.includes('access_token') || window.location.search.includes('code='));

          if (this.isLocalDebug() && !hasOAuthTokens) {
            return;
          }

          this.isAuthenticating.set(true);
          try {
            const userProfile = await this.supabase.ensureOAuthAppUser({
              id: session.user.id,
              email: session.user.email,
              user_metadata: session.user.user_metadata
            });

            if (userProfile) {
              this.currentUser.set(userProfile);
              this.isLocalDebug.set(false);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(userProfile));
              localStorage.removeItem(DEBUG_FLAG_KEY);
              sessionStorage.removeItem(DEBUG_FLAG_KEY);

              // If currently on login page, redirect to dashboard
              if (this.router.url.includes('/login') || this.router.url === '/') {
                this.router.navigate(['/dashboard']);
              }
            }
          } catch (err) {
            console.error('Failed to sync OAuth session profile:', err);
          } finally {
            this.isAuthenticating.set(false);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        if (!this.isLocalDebug()) {
          this.clearLocalSession();
        }
      }
    });
  }

  public async refreshCurrentUser(): Promise<AppUser | null> {
    const user = this.currentUser();
    if (!user || !this.supabase.clientInstance) return user;
    try {
      const refreshed = await this.supabase.fetchAppUserById(user.id);
      if (refreshed) {
        this.currentUser.set(refreshed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
        return refreshed;
      }
    } catch (e) {
      console.warn('Failed to refresh user profile:', e);
    }
    return user;
  }

  public async updateCurrentUserProfile(
    updates: Partial<AppUser>
  ): Promise<{ success: boolean; error?: string; user?: AppUser }> {
    const current = this.currentUser();
    if (!current) {
      return { success: false, error: 'No user is currently signed in' };
    }

    if (this.isLocalDebug() || !this.supabase.hasClient) {
      const updated: AppUser = {
        ...current,
        ...updates
      };
      this.currentUser.set(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      if (sessionStorage.getItem(STORAGE_KEY)) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }

      // Keep mock persona synchronized in debug mode
      const personaKey = Object.keys(MOCK_USERS).find(
        k => MOCK_USERS[k].id === current.id || MOCK_USERS[k].username === current.username
      );
      if (personaKey) {
        MOCK_USERS[personaKey] = { ...MOCK_USERS[personaKey], ...updated };
      }

      return { success: true, user: updated };
    }

    try {
      const res = await this.supabase.updateAppUserProfile(current.id, updates);
      if (!res.success) {
        return { success: false, error: res.error || 'Failed to update user profile' };
      }

      const updatedUser = res.data || { ...current, ...updates };
      this.currentUser.set(updatedUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedUser));
      return { success: true, user: updatedUser };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error occurred while saving profile' };
    }
  }

  public async updatePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const current = this.currentUser();
    if (!current) {
      return { success: false, error: 'No user is currently signed in' };
    }

    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'New password must be at least 6 characters long' };
    }

    if (this.isLocalDebug() || !this.supabase.hasClient) {
      return { success: true };
    }

    return this.supabase.updateAppUserPassword(current.id, currentPassword, newPassword);
  }

  public async setPrimaryHousehold(householdId: string | null): Promise<boolean> {
    const res = await this.updateCurrentUserProfile({ household_id: householdId });
    return res.success;
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

  public async loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
    this.isAuthenticating.set(true);

    if (!this.supabase.clientInstance) {
      this.isAuthenticating.set(false);
      return {
        success: false,
        error: 'Supabase credentials are not configured in environment.'
      };
    }

    try {
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await this.supabase.clientInstance.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account'
          }
        }
      });

      if (error) {
        this.isAuthenticating.set(false);
        return { success: false, error: error.message };
      }

      // Browser redirects to Google OAuth consent
      return { success: true };
    } catch (err: any) {
      this.isAuthenticating.set(false);
      return {
        success: false,
        error: err.message || 'Failed to initiate Google login.'
      };
    }
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

  public async logout(): Promise<void> {
    try {
      if (this.supabase.clientInstance) {
        await this.supabase.clientInstance.auth.signOut();
      }
    } catch (e) {
      console.warn('Supabase sign-out error:', e);
    }
    this.clearLocalSession();
    this.router.navigate(['/login']);
  }

  private clearLocalSession(): void {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEBUG_FLAG_KEY);
    sessionStorage.removeItem(DEBUG_FLAG_KEY);
    this.currentUser.set(null);
    this.isLocalDebug.set(false);
  }
}
