import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideLumberjack } from '@ngworker/lumberjack';
import { HouseholdService, DEFAULT_HOUSEHOLD } from './household.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { NotificationService } from './notification.service';
import { AppUser } from '../models/user.model';
import { Household, HouseholdMember, HouseholdInvitation } from '../models/household.model';
import {
  MOCK_HOUSEHOLDS,
  MOCK_HOUSEHOLD_MEMBERS,
  MOCK_INVITATIONS
} from '../mock/mock-data';

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
        provideLumberjack(),
        HouseholdService,
        NotificationService,
        { provide: AuthService, useValue: mockAuthService },
        { provide: SupabaseService, useValue: mockSupabaseService }
      ]
    });

    service = TestBed.inject(HouseholdService);
    service.households.set([...MOCK_HOUSEHOLDS]);
    service.householdMembers.set([...MOCK_HOUSEHOLD_MEMBERS]);
    service.householdInvitations.set([...MOCK_INVITATIONS]);
  });

  it('should initialize and support test fixture population', () => {
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

    it('should sync currentUser session when the removed member is the currently signed-in user', async () => {
      currentUserSignal.set({
        id: 'user-member-to-remove',
        username: 'member_remove',
        fullName: 'Member To Remove',
        role: 'household_member',
        household_id: 'mock-hh-02',
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'member' }]
      });

      // Set owner as caller so canManage passes
      spyOn(service, 'canManage').and.returnValue(true);

      await service.removeMember('mock-hh-02', 'user-member-to-remove');

      const updated = mockAuthService.currentUser();
      expect(updated?.household_ids).not.toContain('mock-hh-02');
      expect(updated?.memberships?.some(m => m.household_id === 'mock-hh-02')).toBeFalse();
      expect(updated?.household_id).toBeNull();
    });

    it('should not grant role or access when memberships is non-empty and does not contain household', () => {
      currentUserSignal.set({
        id: 'user-strict',
        username: 'strict_user',
        fullName: 'Strict User',
        role: 'household_member',
        household_id: 'mock-hh-01', // Stale scalar
        household_ids: ['mock-hh-02'],
        memberships: [{ household_id: 'mock-hh-02', role: 'member' }]
      });

      // mock-hh-01 is not in user.memberships
      expect(service.getRoleInHousehold('mock-hh-01')).toBeNull();
      expect(service.getRoleInHousehold('mock-hh-02')).toBe('member');
    });

    it('should return empty authorizedHouseholds and not leak all households for unassigned users', () => {
      currentUserSignal.set({
        id: 'user-unassigned',
        username: 'unassigned_user',
        fullName: 'Unassigned User',
        role: 'household_member',
        household_id: null,
        household_ids: [],
        memberships: []
      });

      // Even though MOCK_HOUSEHOLDS has active households, user is authorized for 0
      expect(service.authorizedHouseholds().length).toBe(0);
      expect(service.authorizedHouseholdIds().size).toBe(0);
    });

    it('should merge members across multiple households without wiping state', async () => {
      (service as any).supabase.hasClient = true;
      spyOn((service as any).supabase, 'fetchHouseholdMembers').and.callFake(async (hhId: string) => {
        if (hhId === 'hh-01') {
          return [{
            id: 'm1',
            household_id: 'hh-01',
            user_id: 'u1',
            role_in_household: 'owner' as const,
            username: 'alice',
            fullName: 'Alice'
          }];
        }
        return [{
          id: 'm2',
          household_id: 'hh-02',
          user_id: 'u2',
          role_in_household: 'member' as const,
          username: 'bob',
          fullName: 'Bob'
        }];
      });

      service.householdMembers.set([]);
      await service.loadHouseholdMembers('hh-01');
      expect(service.householdMembers().length).toBe(1);

      await service.loadHouseholdMembers('hh-02');
      expect(service.householdMembers().length).toBe(2);
      expect(service.householdMembers().some(m => m.household_id === 'hh-01')).toBeTrue();
      expect(service.householdMembers().some(m => m.household_id === 'hh-02')).toBeTrue();
    });
  });
});
