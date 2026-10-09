import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ProfileComponent, AVATAR_PRESETS } from './profile';
import { AuthService } from '../../core/services/auth.service';
import { MealStoreService } from '../../core/services/meal-store.service';
import { AppUser } from '../../core/models/user.model';
import { Household } from '../../core/models/household.model';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;

  const initialUser: AppUser = {
    id: 'user-test-01',
    username: 'priya_patel',
    fullName: 'Priya Patel',
    role: 'household_member',
    email: 'priya@example.com',
    phone: '+91 98765 00000',
    dietary_preferences: 'Jain (no onion/garlic)',
    bio: 'Apartment 402 resident.',
    household_id: 'hh-test-01',
    household_ids: ['hh-test-01']
  };

  const currentUserSignal = signal<AppUser | null>(initialUser);

  const mockHouseholds: Household[] = [
    {
      id: 'hh-test-01',
      name: 'Apartment 402',
      code: 'APT-402',
      default_headcount: 2,
      is_active: true,
      color_tag: '#f59e0b',
      dietary_notes: 'Jain, no onion/garlic'
    }
  ];

  let updateProfileSpy: jasmine.Spy;
  let updatePasswordSpy: jasmine.Spy;
  let setPrimaryHouseholdSpy: jasmine.Spy;
  let showNotificationSpy: jasmine.Spy;
  let setSelectedHouseholdSpy: jasmine.Spy;

  beforeEach(async () => {
    updateProfileSpy = jasmine.createSpy('updateCurrentUserProfile').and.returnValue(
      Promise.resolve({ success: true, user: { ...initialUser, fullName: 'Priya P. Updated' } })
    );
    updatePasswordSpy = jasmine.createSpy('updatePassword').and.returnValue(
      Promise.resolve({ success: true })
    );
    setPrimaryHouseholdSpy = jasmine.createSpy('setPrimaryHousehold').and.returnValue(
      Promise.resolve(true)
    );
    showNotificationSpy = jasmine.createSpy('showNotification');
    setSelectedHouseholdSpy = jasmine.createSpy('setSelectedHousehold');

    const mockAuthService = {
      currentUser: currentUserSignal,
      updateCurrentUserProfile: updateProfileSpy,
      updatePassword: updatePasswordSpy,
      setPrimaryHousehold: setPrimaryHouseholdSpy,
      logout: jasmine.createSpy('logout')
    };

    const mockMealStore = {
      authorizedHouseholds: signal(mockHouseholds),
      householdsMap: signal(new Map([['hh-test-01', mockHouseholds[0]]])),
      householdMembers: signal([]),
      showNotification: showNotificationSpy,
      setSelectedHousehold: setSelectedHouseholdSpy
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: MealStoreService, useValue: mockMealStore }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and populate form from current user signal', () => {
    expect(component).toBeTruthy();
    expect(component.fullName()).toBe('Priya Patel');
    expect(component.username()).toBe('priya_patel');
    expect(component.email()).toBe('priya@example.com');
    expect(component.dietaryPreferences()).toBe('Jain (no onion/garlic)');
    expect(component.selectedHouseholdId()).toBe('hh-test-01');
    expect(component.isDirty()).toBeFalse();
  });

  it('should detect dirty state when fields change', () => {
    expect(component.isDirty()).toBeFalse();
    component.fullName.set('Priya Patel-Sharma');
    expect(component.isDirty()).toBeTrue();

    component.fullName.set('Priya Patel');
    expect(component.isDirty()).toBeFalse();

    component.dietaryPreferences.set('Vegan');
    expect(component.isDirty()).toBeTrue();
  });

  it('should switch tabs properly', () => {
    expect(component.activeTab()).toBe('general');
    component.setTab('avatar');
    expect(component.activeTab()).toBe('avatar');
    component.setTab('security');
    expect(component.activeTab()).toBe('security');
    component.setTab('households');
    expect(component.activeTab()).toBe('households');
  });

  it('should select an avatar preset and mark dirty', () => {
    const preset = AVATAR_PRESETS[0];
    component.selectAvatarPreset(preset);
    expect(component.avatarUrl()).toBe(preset.emoji);
    expect(component.isDirty()).toBeTrue();
  });

  it('should clear custom avatar', () => {
    component.avatarUrl.set('👨‍🍳');
    component.clearAvatar();
    expect(component.avatarUrl()).toBe('');
  });

  it('should compute user initials accurately', () => {
    expect(component.userInitials()).toBe('PP');

    component.fullName.set('Admin');
    // currentUser signal has 'Priya Patel'
    expect(component.userInitials()).toBe('PP');
  });

  it('should save profile changes and show success notification', async () => {
    component.fullName.set('Priya P. Updated');
    component.dietaryPreferences.set('Strict Jain');
    expect(component.isDirty()).toBeTrue();

    await component.saveProfile();

    expect(updateProfileSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({
        fullName: 'Priya P. Updated',
        username: 'priya_patel',
        dietary_preferences: 'Strict Jain'
      })
    );
    expect(showNotificationSpy).toHaveBeenCalledWith('Profile updated successfully!', 'success');
  });

  it('should validate empty full name and username before saving', async () => {
    component.fullName.set('');
    await component.saveProfile();
    expect(showNotificationSpy).toHaveBeenCalledWith('Full name cannot be empty', 'error');
    expect(updateProfileSpy).not.toHaveBeenCalled();

    component.fullName.set('Valid Name');
    component.username.set('');
    await component.saveProfile();
    expect(showNotificationSpy).toHaveBeenCalledWith('Username cannot be empty', 'error');
  });

  it('should validate password mismatch and length', () => {
    component.newPassword.set('123');
    expect(component.passwordTooShort()).toBeTrue();

    component.newPassword.set('secret123');
    component.confirmPassword.set('different123');
    expect(component.passwordMismatch()).toBeTrue();
    expect(component.canSubmitPassword()).toBeFalse();

    component.confirmPassword.set('secret123');
    expect(component.passwordMismatch()).toBeFalse();
    expect(component.canSubmitPassword()).toBeTrue();
  });

  it('should submit password update successfully', async () => {
    component.currentPassword.set('oldpass123');
    component.newPassword.set('newpass123');
    component.confirmPassword.set('newpass123');

    await component.updatePassword();

    expect(updatePasswordSpy).toHaveBeenCalledWith('oldpass123', 'newpass123');
    expect(showNotificationSpy).toHaveBeenCalledWith('Password updated successfully!', 'success');
    expect(component.newPassword()).toBe('');
    expect(component.confirmPassword()).toBe('');
  });

  it('should set primary household and synchronize', async () => {
    await component.setAsPrimaryHousehold('hh-test-01');
    expect(setPrimaryHouseholdSpy).toHaveBeenCalledWith('hh-test-01');
    expect(setSelectedHouseholdSpy).toHaveBeenCalledWith('hh-test-01');
    expect(showNotificationSpy).toHaveBeenCalledWith('Set Apartment 402 as your primary household', 'success');
  });
});
