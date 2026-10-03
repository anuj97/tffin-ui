import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LumberjackService } from '@ngworker/lumberjack';
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
  private lumberjack = inject(LumberjackService);
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
    if (typeof localStorage === 'undefined') return false;
    return (
      localStorage.getItem(DEBUG_FLAG_KEY) === 'true' ||
      sessionStorage.getItem(DEBUG_FLAG_KEY) === 'true' ||
      !this.supabase.hasClient
    );
  }

  private loadStoredUser(): AppUser | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as AppUser;
      }
    } catch (e) {
      this.lumberjack.logWarning('Failed to parse cached auth session', { error: String(e) }, 'AuthService');
    }
    return null;
  }

  private initSupabaseAuthListener(): void {
    const client = this.supabase.clientInstance;
    if (!client) return;

    client.auth.onAuthStateChange(async (event, session) => {
      this.lumberjack.logInfo(`Supabase auth state changed: ${event}`, { userId: session?.user?.id }, 'AuthService');

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
              this.lumberjack.logInfo('OAuth user profile synchronized successfully', { username: userProfile.username, id: userProfile.id }, 'AuthService');
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
          } catch (err: any) {
            this.lumberjack.logError('Failed to sync OAuth session profile', { error: err?.message || String(err) }, 'AuthService');
          } finally {
            this.isAuthenticating.set(false);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        if (!this.isLocalDebug()) {
          this.lumberjack.logInfo('User signed out via Supabase auth', undefined, 'AuthService');
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
    } catch (e: any) {
      this.lumberjack.logWarning('Failed to refresh user profile', { error: e?.message || String(e) }, 'AuthService');
    }
    return user;
  }

  public async updateCurrentUserProfile(
    updates: Partial<AppUser>
  ): Promise<{ success: boolean; error?: string; user?: AppUser }> {
    const current = this.currentUser();
    if (!current) {
      this.lumberjack.logWarning('Cannot update profile: no user currently signed in', undefined, 'AuthService');
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

      this.lumberjack.logInfo('Updated profile in local debug mode', { username: updated.username }, 'AuthService');
      return { success: true, user: updated };
    }

    try {
      const res = await this.supabase.updateAppUserProfile(current.id, updates);
      if (!res.success) {
        this.lumberjack.logWarning(`Failed to update profile: ${res.error}`, undefined, 'AuthService');
        return { success: false, error: res.error || 'Failed to update user profile' };
      }

      const updatedUser = res.data || { ...current, ...updates };
      this.currentUser.set(updatedUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedUser));
      this.lumberjack.logInfo('User profile saved successfully in Supabase', { userId: current.id }, 'AuthService');
      return { success: true, user: updatedUser };
    } catch (err: any) {
      this.lumberjack.logError('Error occurred while saving profile', { error: err?.message || String(err), userId: current.id }, 'AuthService');
      return { success: false, error: err.message || 'Error occurred while saving profile' };
    }
  }

  public async updatePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const current = this.currentUser();
    if (!current) {
      this.lumberjack.logWarning('Cannot update password: no user signed in', undefined, 'AuthService');
      return { success: false, error: 'No user is currently signed in' };
    }

    if (!newPassword || newPassword.length < 6) {
      this.lumberjack.logWarning('Password update rejected: New password too short', undefined, 'AuthService');
      return { success: false, error: 'New password must be at least 6 characters long' };
    }

    if (this.isLocalDebug() || !this.supabase.hasClient) {
      this.lumberjack.logInfo('Password updated simulated in local debug mode', undefined, 'AuthService');
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

    this.lumberjack.logInfo('Logging in with local debug persona', { personaKey, username: user.username, role: user.role }, 'AuthService');
    this.currentUser.set(user);
    this.isLocalDebug.set(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(DEBUG_FLAG_KEY, 'true');
    return { success: true };
  }

  public async loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
    this.lumberjack.logInfo('Initiating Google OAuth login flow', undefined, 'AuthService');
    this.isAuthenticating.set(true);

    if (!this.supabase.clientInstance) {
      this.lumberjack.logWarning('Google login failed: Supabase credentials not configured in environment', undefined, 'AuthService');
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
        this.lumberjack.logWarning(`Google OAuth signInWithOAuth error: ${error.message}`, undefined, 'AuthService');
        this.isAuthenticating.set(false);
        return { success: false, error: error.message };
      }

      this.lumberjack.logInfo('Redirecting user to Google OAuth provider', undefined, 'AuthService');
      return { success: true };
    } catch (err: any) {
      this.lumberjack.logError('Failed to initiate Google login', { error: err?.message || String(err) }, 'AuthService');
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
    this.lumberjack.logInfo('Authenticating user credentials', { username, rememberMe }, 'AuthService');
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

      this.lumberjack.logWarning('Login rejected: Supabase not configured and invalid debug credentials', { username }, 'AuthService');
      return {
        success: false,
        error: 'Supabase credentials are not configured. Click one of the test persona buttons below or sign in with admin / admin123.'
      };
    }

    try {
      const user = await this.supabase.verifyUserCredentials(username, password);
      this.isAuthenticating.set(false);

      if (!user) {
        this.lumberjack.logWarning('Login failed: Invalid credentials provided', { username }, 'AuthService');
        return {
          success: false,
          error: 'Invalid username or password. Please try again.'
        };
      }

      this.lumberjack.logInfo('User successfully authenticated', { username: user.username, role: user.role, id: user.id }, 'AuthService');
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
      this.lumberjack.logError('Connection error during authentication', { error: err?.message || String(err), username }, 'AuthService');
      this.isAuthenticating.set(false);
      return {
        success: false,
        error: err.message || 'Connection error while contacting authentication service.'
      };
    }
  }

  public async logout(): Promise<void> {
    this.lumberjack.logInfo('Logging out user', { username: this.currentUser()?.username }, 'AuthService');
    try {
      if (this.supabase.clientInstance) {
        await this.supabase.clientInstance.auth.signOut();
      }
    } catch (e: any) {
      this.lumberjack.logWarning('Supabase sign-out error', { error: e?.message || String(e) }, 'AuthService');
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
