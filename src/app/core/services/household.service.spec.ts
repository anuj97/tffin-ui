import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HouseholdService, DEFAULT_HOUSEHOLD } from './household.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { NotificationService } from './notification.service';
import { AppUser } from '../models/user.model';
import { Household, HouseholdMember, HouseholdInvitation } from '../models/household.model';

describe('HouseholdService (Membership & Role Architecture)', () => {
  let service: HouseholdService;
  let currentUserSignal = signal<AppUser | null>({
    id: 'user-admin',
    username: 'admin',
    role: 'admin',
    fullName: 'Kitchen Super Admin',
    household_ids: [],
    memberships: []
  });

  const mockAuthService = {
    currentUser: currentUserSignal,
    isLocalDebug: signal<boolean>(true),
    refreshCurrentUser: jasmine.createSpy('refreshCurrentUser').and.resolveTo(null)
  };

  const mockSupabaseService = {
    hasClient: false,
    fetchHouseholds: async () => [],
    fetchHouseholdMembers: async () => [],
    fetchHouseholdInvitations: async () => []
  };

  beforeEach(() => {
    currentUserSignal.set({
      id: 'user-admin',
      username: 'admin',
      role: 'admin',
      fullName: 'Kitchen Super Admin',
      household_ids: [],
      memberships: []
    });

    TestBed.configureTestingModule({
      providers: [
        HouseholdService,
        NotificationService,
        { provide: AuthService, useValue: mockAuthService },
        { provide: SupabaseService, useValue: mockSupabaseService }
      ]
    });

    service = TestBed.inject(HouseholdService);
  });

  it('should initialize with mock data in debug/offline mode', () => {
    expect(service.households().length).toBeGreaterThan(0);
    expect(service.householdMembers().length).toBeGreaterThan(0);
    expect(service.householdInvitations().length).toBeGreaterThan(0);
    expect(service.selectedHouseholdId()).toBeNull();
  });

  describe('Contextual Household Role vs System Role', () => {
    it('should recognize household owner even when system role is household_member', () => {
      // Amit Verma: system role is household_member, but he is owner of Verma Residence (mock-hh-02)
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_id: 'mock-hh-02',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'owner' }]
      });

      expect(service.getRoleInHousehold('mock-hh-02')).toBe('owner');
      expect(service.isOwner('mock-hh-02')).toBeTrue();
      expect(service.canManage('mock-hh-02')).toBeTrue();
      expect(service.canPlanMeals('mock-hh-02')).toBeTrue();
      expect(service.isViewer('mock-hh-02')).toBeFalse();

      // Verma cannot manage Main Household (mock-hh-01)
      expect(service.isOwner('mock-hh-01')).toBeFalse();
      expect(service.canManage('mock-hh-01')).toBeFalse();
    });

    it('should enable canManageAnyHousehold for household owners', () => {
      currentUserSignal.set({
        id: 'user-priya',
        username: 'priya_patel',
        fullName: 'Priya Patel',
        role: 'household_member',
        household_id: 'mock-hh-03',
        household_ids: ['mock-hh-03'],
        memberships: [{ household_id: 'mock-hh-03', role: 'owner' }]
      });

      expect(service.canManageAnyHousehold()).toBeTrue();
      expect(service.ownedHouseholdIds().has('mock-hh-03')).toBeTrue();
    });

    it('should distinguish member from owner in permissions', () => {
      // Kiran is a regular member in mock-hh-02
      currentUserSignal.set({
        id: 'user-multi',
        username: 'kiran_manager',
        fullName: 'Kiran Manager',
        role: 'household_member',
        household_ids: ['mock-hh-02', 'mock-hh-03'],
        memberships: [
          { household_id: 'mock-hh-02', role: 'member' },
          { household_id: 'mock-hh-03', role: 'member' }
        ]
      });

      expect(service.getRoleInHousehold('mock-hh-02')).toBe('member');
      expect(service.isOwner('mock-hh-02')).toBeFalse();
      expect(service.canManage('mock-hh-02')).toBeFalse();
      expect(service.canPlanMeals('mock-hh-02')).toBeTrue();
    });

    it('should restrict viewers from planning meals', () => {
      currentUserSignal.set({
        id: 'user-viewer',
        username: 'grandpa_viewer',
        fullName: 'Grandpa Viewer',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'viewer' }]
      });

      expect(service.getRoleInHousehold('mock-hh-02')).toBe('viewer');
      expect(service.isViewer('mock-hh-02')).toBeTrue();
      expect(service.canPlanMeals('mock-hh-02')).toBeFalse();
      expect(service.canManage('mock-hh-02')).toBeFalse();
    });
  });

  describe('Unassigned User Household Creation', () => {
    it('should allow an unassigned user to create a household and become owner', async () => {
      currentUserSignal.set({
        id: 'user-rohan',
        username: 'rohan_new',
        fullName: 'Rohan Sharma',
        role: 'household_member',
        household_ids: [],
        memberships: []
      });

      expect(service.authorizedHouseholds().length).toBe(0);
      expect(service.canManageAnyHousehold()).toBeTrue();

      const created = await service.createHousehold({
        name: 'Sharma Villa',
        code: 'HH-SHARMA',
        default_headcount: 3
      });

      expect(created).toBeTruthy();
      expect(service.households().some(h => h.id === created!.id)).toBeTrue();

      // Assigned as owner
      const rosterMember = service.householdMembers().find(
        m => m.household_id === created!.id && m.user_id === 'user-rohan'
      );
      expect(rosterMember).toBeTruthy();
      expect(rosterMember?.role_in_household).toBe('owner');

      // Updated user memberships
      const updatedUser = mockAuthService.currentUser();
      expect(updatedUser?.household_ids).toContain(created!.id);
      expect(updatedUser?.memberships?.some(m => m.household_id === created!.id && m.role === 'owner')).toBeTrue();

      // Selected household updated
      expect(service.selectedHouseholdId()).toBe(created!.id);
    });
  });

  describe('Household Updates and Deletions', () => {
    it('should allow household owner to update household profile', async () => {
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'owner' }]
      });

      const updated = await service.updateHousehold('mock-hh-02', {
        name: 'Verma Family Residence',
        default_headcount: 5
      });

      expect(updated).toBeTruthy();
      expect(service.householdsMap().get('mock-hh-02')?.name).toBe('Verma Family Residence');
      expect(service.householdsMap().get('mock-hh-02')?.default_headcount).toBe(5);
    });

    it('should block non-owner from updating household profile', async () => {
      currentUserSignal.set({
        id: 'user-multi',
        username: 'kiran_manager',
        fullName: 'Kiran Manager',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'member' }]
      });

      const updated = await service.updateHousehold('mock-hh-02', {
        name: 'Hacked Name'
      });

      expect(updated).toBeNull();
      expect(service.householdsMap().get('mock-hh-02')?.name).not.toBe('Hacked Name');
    });

    it('should allow owner to delete household with full cascade', async () => {
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'owner' }]
      });

      service.selectedHouseholdId.set('mock-hh-02');

      const success = await service.deleteHousehold('mock-hh-02');
      expect(success).toBeTrue();
      expect(service.households().some(h => h.id === 'mock-hh-02')).toBeFalse();
      expect(service.householdMembers().some(m => m.household_id === 'mock-hh-02')).toBeFalse();
      expect(service.householdInvitations().some(i => i.household_id === 'mock-hh-02')).toBeFalse();
      expect(service.selectedHouseholdId()).toBeNull();
    });

    it('should reject deletion by non-owner member', async () => {
      currentUserSignal.set({
        id: 'user-multi',
        username: 'kiran_manager',
        fullName: 'Kiran Manager',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'member' }]
      });

      const success = await service.deleteHousehold('mock-hh-02');
      expect(success).toBeFalse();
      expect(service.households().some(h => h.id === 'mock-hh-02')).toBeTrue();
    });
  });

  describe('Invitations & Member Rosters', () => {
    it('should allow owner to create invite link', async () => {
      currentUserSignal.set({
        id: 'user-verma',
        username: 'amit_verma',
        fullName: 'Amit Verma',
        role: 'household_member',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'owner' }]
      });

      const inv = await service.createInviteLink('mock-hh-02', 'member', 'guest@example.com', 7);
      expect(inv).toBeTruthy();
      expect(inv.household_id).toBe('mock-hh-02');
      expect(inv.role_in_household).toBe('member');
      expect(service.householdInvitations().some(i => i.id === inv.id)).toBeTrue();
    });

    it('should allow user to accept invite code and join household', async () => {
      currentUserSignal.set({
        id: 'user-newbie',
        username: 'newbie_guest',
        fullName: 'Newbie Guest',
        role: 'household_member',
        household_ids: [],
        memberships: []
      });

      // Existing mock invitation
      const res = await service.acceptInviteCode('TFFN-VERMA77');
      expect(res.success).toBeTrue();
      expect(res.household_id).toBe('mock-hh-02');

      const member = service.householdMembers().find(
        m => m.household_id === 'mock-hh-02' && m.user_id === 'user-newbie'
      );
      expect(member).toBeTruthy();
      expect(member?.role_in_household).toBe('member');
    });
  });
});
