import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { MealStoreService } from '../../core/services/meal-store.service';
import { AppUser } from '../../core/models/user.model';
import { HouseholdMemberRole } from '../../core/models/household.model';

export interface AvatarPreset {
  id: string;
  name: string;
  emoji: string;
  category: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'chef-1', name: 'Master Chef', emoji: '👨‍🍳', category: 'Culinary' },
  { id: 'chef-2', name: 'Executive Chef', emoji: '👩‍🍳', category: 'Culinary' },
  { id: 'chef-3', name: 'Kitchen Artist', emoji: '🧑‍🍳', category: 'Culinary' },
  { id: 'pot', name: 'Biryani Pot', emoji: '🍲', category: 'Food' },
  { id: 'salad', name: 'Healthy Greens', emoji: '🥗', category: 'Food' },
  { id: 'curry', name: 'Royal Curry', emoji: '🍛', category: 'Food' },
  { id: 'tiffin', name: 'Tiffin Box', emoji: '🍱', category: 'Food' },
  { id: 'avo', name: 'Avocado Fresh', emoji: '🥑', category: 'Produce' },
  { id: 'chili', name: 'Spicy Flame', emoji: '🌶️', category: 'Flavors' },
  { id: 'flatbread', name: 'Roti & Bread', emoji: '🫓', category: 'Food' },
  { id: 'tea', name: 'Masala Chai', emoji: '☕', category: 'Beverages' },
  { id: 'star', name: 'Kitchen Star', emoji: '⭐', category: 'Badges' }
];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  public auth = inject(AuthService);
  public store = inject(MealStoreService);
  private router = inject(Router);

  // Tab State
  public activeTab = signal<'general' | 'avatar' | 'security' | 'households'>('general');

  // Form Signals
  public fullName = signal<string>('');
  public username = signal<string>('');
  public email = signal<string>('');
  public phone = signal<string>('');
  public dietaryPreferences = signal<string>('');
  public bio = signal<string>('');
  public avatarUrl = signal<string>('');
  public selectedHouseholdId = signal<string>('');

  // Password Update Signals
  public currentPassword = signal<string>('');
  public newPassword = signal<string>('');
  public confirmPassword = signal<string>('');
  public showCurrentPassword = signal<boolean>(false);
  public showNewPassword = signal<boolean>(false);
  public showConfirmPassword = signal<boolean>(false);

  // UI State Signals
  public isSaving = signal<boolean>(false);
  public isUpdatingPassword = signal<boolean>(false);
  public copiedId = signal<boolean>(false);

  public avatarPresets = AVATAR_PRESETS;

  // Computed Properties
  public currentUser = computed(() => this.auth.currentUser());

  public isGoogleUser = computed(() => {
    const u = this.currentUser();
    if (!u) return false;
    return !!u.avatar_url?.includes('googleusercontent') || !!u.email?.endsWith('@gmail.com');
  });

  public userInitials = computed(() => {
    const u = this.currentUser();
    if (!u) return 'U';
    const name = (u.fullName || u.username).trim();
    if (!name) return 'U';
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  });

  public isDirty = computed(() => {
    const u = this.currentUser();
    if (!u) return false;
    return (
      this.fullName().trim() !== (u.fullName || '').trim() ||
      this.username().trim() !== (u.username || '').trim() ||
      this.email().trim() !== (u.email || '').trim() ||
      this.phone().trim() !== (u.phone || '').trim() ||
      this.dietaryPreferences().trim() !== (u.dietary_preferences || '').trim() ||
      this.bio().trim() !== (u.bio || '').trim() ||
      this.avatarUrl().trim() !== (u.avatar_url || '').trim() ||
      this.selectedHouseholdId() !== (u.household_id || '')
    );
  });

  public passwordMismatch = computed(() => {
    const np = this.newPassword();
    const cp = this.confirmPassword();
    return !!np && !!cp && np !== cp;
  });

  public passwordTooShort = computed(() => {
    const np = this.newPassword();
    return !!np && np.length < 6;
  });

  public canSubmitPassword = computed(() => {
    return (
      !!this.newPassword() &&
      this.newPassword().length >= 6 &&
      this.newPassword() === this.confirmPassword() &&
      !this.isUpdatingPassword()
    );
  });

  public authorizedHouseholds = computed(() => this.store.authorizedHouseholds());

  public currentPrimaryHousehold = computed(() => {
    const hhId = this.currentUser()?.household_id;
    if (!hhId) return null;
    return this.store.householdsMap().get(hhId) || null;
  });

  public userMemberships = computed(() => {
    const u = this.currentUser();
    if (!u) return [];
    if (u.memberships && u.memberships.length > 0) {
      return u.memberships;
    }
    const roster = this.store.householdMembers().filter(m => m.user_id === u.id);
    if (roster.length > 0) {
      return roster.map(m => ({
        household_id: m.household_id,
        role: m.role_in_household
      }));
    }
    const authed = this.authorizedHouseholds();
    if (authed.length > 0) {
      return authed.map(h => ({
        household_id: h.id,
        role: (u.role === 'owner' ? 'owner' : 'member') as HouseholdMemberRole
      }));
    }
    return [];
  });

  ngOnInit(): void {
    this.populateForm(this.currentUser());
  }

  public populateForm(user: AppUser | null): void {
    if (!user) return;
    this.fullName.set(user.fullName || '');
    this.username.set(user.username || '');
    this.email.set(user.email || '');
    this.phone.set(user.phone || '');
    this.dietaryPreferences.set(user.dietary_preferences || '');
    this.bio.set(user.bio || '');
    this.avatarUrl.set(user.avatar_url || '');
    this.selectedHouseholdId.set(user.household_id || '');
  }

  public resetForm(): void {
    this.populateForm(this.currentUser());
    this.store.showNotification('Changes discarded', 'info');
  }

  public setTab(tab: 'general' | 'avatar' | 'security' | 'households'): void {
    this.activeTab.set(tab);
  }

  public selectAvatarPreset(preset: AvatarPreset): void {
    this.avatarUrl.set(preset.emoji);
  }

  public clearAvatar(): void {
    this.avatarUrl.set('');
  }

  public copyUserId(): void {
    const id = this.currentUser()?.id;
    if (!id) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(id).then(() => {
        this.copiedId.set(true);
        setTimeout(() => this.copiedId.set(false), 2000);
      });
    } else {
      this.copiedId.set(true);
      setTimeout(() => this.copiedId.set(false), 2000);
    }
  }

  public async saveProfile(): Promise<void> {
    const u = this.currentUser();
    if (!u) return;

    const trimmedFullName = this.fullName().trim();
    const trimmedUsername = this.username().trim();

    if (!trimmedFullName) {
      this.store.showNotification('Full name cannot be empty', 'error');
      return;
    }

    if (!trimmedUsername) {
      this.store.showNotification('Username cannot be empty', 'error');
      return;
    }

    // Username format check (letters, digits, underscores)
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedUsername)) {
      this.store.showNotification('Username can only contain letters, numbers, dots, and underscores', 'error');
      return;
    }

    this.isSaving.set(true);

    try {
      const res = await this.auth.updateCurrentUserProfile({
        fullName: trimmedFullName,
        username: trimmedUsername,
        email: this.email().trim() || undefined,
        phone: this.phone().trim() || undefined,
        dietary_preferences: this.dietaryPreferences().trim() || undefined,
        bio: this.bio().trim() || undefined,
        avatar_url: this.avatarUrl().trim() || undefined,
        household_id: this.selectedHouseholdId() || null
      });

      if (res.success) {
        this.store.showNotification('Profile updated successfully!', 'success');
        // If primary household changed, synchronize active household in store
        if (this.selectedHouseholdId()) {
          this.store.setSelectedHousehold(this.selectedHouseholdId());
        }
      } else {
        this.store.showNotification(res.error || 'Failed to update profile', 'error');
      }
    } catch (err: any) {
      this.store.showNotification(err.message || 'An unexpected error occurred', 'error');
    } finally {
      this.isSaving.set(false);
    }
  }

  public async updatePassword(): Promise<void> {
    if (!this.canSubmitPassword()) return;

    this.isUpdatingPassword.set(true);

    try {
      const res = await this.auth.updatePassword(
        this.currentPassword(),
        this.newPassword()
      );

      if (res.success) {
        this.store.showNotification('Password updated successfully!', 'success');
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
      } else {
        this.store.showNotification(res.error || 'Failed to update password', 'error');
      }
    } catch (err: any) {
      this.store.showNotification(err.message || 'An error occurred while changing password', 'error');
    } finally {
      this.isUpdatingPassword.set(false);
    }
  }

  public async setAsPrimaryHousehold(hhId: string): Promise<void> {
    this.selectedHouseholdId.set(hhId);
    await this.auth.setPrimaryHousehold(hhId);
    this.store.setSelectedHousehold(hhId);
    const hh = this.store.householdsMap().get(hhId);
    this.store.showNotification(`Set ${hh?.name || 'household'} as your primary household`, 'success');
  }

  public onLogout(): void {
    this.auth.logout();
  }

  public toggleCurrentPassword(): void {
    this.showCurrentPassword.update(v => !v);
  }

  public toggleNewPassword(): void {
    this.showNewPassword.update(v => !v);
  }

  public toggleConfirmPassword(): void {
    this.showConfirmPassword.update(v => !v);
  }
}
