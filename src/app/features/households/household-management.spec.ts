import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { HouseholdManagementComponent } from './household-management';
import { HouseholdService } from '../../core/services/household.service';
import { MealStoreService } from '../../core/services/meal-store.service';
import { AuthService } from '../../core/services/auth.service';
import { AppUser } from '../../core/models/user.model';
import { Household, HouseholdMember, HouseholdInvitation } from '../../core/models/household.model';

describe('HouseholdManagementComponent', () => {
  let component: HouseholdManagementComponent;
  let fixture: ComponentFixture<HouseholdManagementComponent>;

  const mockUserSignal = signal<AppUser | null>({
    id: 'user-verma',
    username: 'amit_verma',
    role: 'household_member',
    fullName: 'Amit Verma',
    household_ids: ['mock-hh-02']
  });

  const mockHouseholds: Household[] = [
    {
      id: 'mock-hh-02',
      name: 'Verma Residence',
      code: 'HH-02',
      default_headcount: 4,
      is_active: true,
      color_tag: '#10b981'
    }
  ];

  const mockMembersSignal = signal<HouseholdMember[]>([
    {
      id: 'hm-1',
      household_id: 'mock-hh-02',
      user_id: 'user-verma',
      role_in_household: 'owner',
      username: 'amit_verma',
      fullName: 'Amit Verma'
    }
  ]);

  const mockInvitationsSignal = signal<HouseholdInvitation[]>([
    {
      id: 'inv-1',
      household_id: 'mock-hh-02',
      invite_code: 'TFFN-TEST01',
      role_in_household: 'member',
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_at: new Date().toISOString()
    }
  ]);

  const mockHouseholdService = {
    activeHouseholds: signal(mockHouseholds),
    authorizedHouseholds: signal(mockHouseholds),
    authorizedHouseholdIds: signal(new Set(['mock-hh-02'])),
    effectiveHouseholdId: signal('mock-hh-02'),
    householdsMap: signal(new Map([['mock-hh-02', mockHouseholds[0]]])),
    householdMembers: mockMembersSignal,
    householdInvitations: mockInvitationsSignal,
    canManage: jasmine.createSpy('canManage').and.returnValue(true),
    isOwner: jasmine.createSpy('isOwner').and.returnValue(true),
    canPlanMeals: jasmine.createSpy('canPlanMeals').and.returnValue(true),
    getRoleInHousehold: jasmine.createSpy('getRoleInHousehold').and.returnValue('owner'),
    loadHouseholdMembers: jasmine.createSpy('loadHouseholdMembers'),
    loadHouseholdInvitations: jasmine.createSpy('loadHouseholdInvitations'),
    createInviteLink: jasmine.createSpy('createInviteLink').and.resolveTo({
      id: 'inv-new',
      household_id: 'mock-hh-02',
      invite_code: 'TFFN-NEW99',
      role_in_household: 'member',
      status: 'pending',
      expires_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }),
    revokeInvite: jasmine.createSpy('revokeInvite'),
    removeMember: jasmine.createSpy('removeMember'),
    acceptInviteCode: jasmine.createSpy('acceptInviteCode').and.resolveTo({
      success: true,
      message: 'Joined household',
      household_id: 'mock-hh-02'
    }),
    setSelectedHousehold: jasmine.createSpy('setSelectedHousehold'),
    updateHousehold: jasmine.createSpy('updateHousehold'),
    createHousehold: jasmine.createSpy('createHousehold').and.resolveTo({
      id: 'mock-created-01',
      name: 'New Household',
      default_headcount: 3
    }),
    deleteHousehold: jasmine.createSpy('deleteHousehold').and.resolveTo(true)
  };

  const mockStore = {
    ...mockHouseholdService,
    showNotification: jasmine.createSpy('showNotification')
  };

  const mockAuth = {
    currentUser: mockUserSignal
  };

  beforeEach(async () => {
    mockMembersSignal.set([
      {
        id: 'hm-1',
        household_id: 'mock-hh-02',
        user_id: 'user-verma',
        role_in_household: 'owner',
        username: 'amit_verma',
        fullName: 'Amit Verma'
      }
    ]);

    await TestBed.configureTestingModule({
      imports: [HouseholdManagementComponent],
      providers: [
        provideRouter([]),
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: MealStoreService, useValue: mockStore },
        { provide: AuthService, useValue: mockAuth },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParams: {} }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize and select the active household', () => {
    expect(component.selectedHouseholdId()).toBe('mock-hh-02');
    expect(component.currentHousehold()?.name).toBe('Verma Residence');
    expect(component.currentMembers().length).toBe(1);
    expect(component.canManage()).toBeTrue();
  });

  it('should generate an invite link on demand', async () => {
    component.openInviteModal();
    expect(component.isInviteModalOpen()).toBeTrue();

    await component.generateInvite();
    expect(mockHouseholdService.createInviteLink).toHaveBeenCalled();
    expect(component.generatedInvite()?.invite_code).toBe('TFFN-NEW99');
  });

  it('should construct correct invite URL with code', () => {
    const url = component.getInviteUrl('TFFN-ABC123');
    expect(url).toContain('/households?join=TFFN-ABC123');
  });

  it('should accept invite code and switch household', async () => {
    component.openJoinModal();
    component.joinCodeInput.set('TFFN-TEST01');
    await component.submitJoinCode();

    expect(mockHouseholdService.acceptInviteCode).toHaveBeenCalledWith('TFFN-TEST01');
    expect(component.isJoinModalOpen()).toBeFalse();
  });

  it('should open and close the delete confirmation modal', () => {
    expect(component.isDeleteModalOpen()).toBeFalse();
    component.openDeleteModal();
    expect(component.isDeleteModalOpen()).toBeTrue();
    component.closeDeleteModal();
    expect(component.isDeleteModalOpen()).toBeFalse();
  });

  it('should call householdService.deleteHousehold and close modal when confirmed', async () => {
    component.openDeleteModal();
    expect(component.isDeleteModalOpen()).toBeTrue();

    await component.confirmDeleteHousehold();

    expect(mockHouseholdService.deleteHousehold).toHaveBeenCalledWith('mock-hh-02');
    expect(component.isDeleteModalOpen()).toBeFalse();
  });

  it('should open and close the create household modal', () => {
    expect(component.isCreateModalOpen()).toBeFalse();
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBeTrue();
    expect(component.createHeadcount()).toBe(2);

    component.closeCreateModal();
    expect(component.isCreateModalOpen()).toBeFalse();
  });

  it('should submit create household and select the new household', async () => {
    component.openCreateModal();
    component.createName.set('New Household');
    component.createHeadcount.set(3);

    await component.submitCreateHousehold();

    expect(mockHouseholdService.createHousehold).toHaveBeenCalledWith(jasmine.objectContaining({
      name: 'New Household',
      default_headcount: 3
    }));
    expect(component.isCreateModalOpen()).toBeFalse();
    expect(component.selectedHouseholdId()).toBe('mock-created-01');
  });

  it('should display all members of the household', () => {
    mockMembersSignal.set([
      {
        id: 'hm-1',
        household_id: 'mock-hh-02',
        user_id: 'user-verma',
        role_in_household: 'owner',
        username: 'amit_verma',
        fullName: 'Amit Verma'
      },
      {
        id: 'hm-2',
        household_id: 'mock-hh-02',
        user_id: 'user-kiran',
        role_in_household: 'member',
        username: 'kiran_manager',
        fullName: 'Kiran Manager'
      }
    ]);

    expect(component.currentMembers().length).toBe(2);
    expect(component.currentMembers().map(m => m.username)).toContain('kiran_manager');
    expect(component.currentMembers().map(m => m.username)).toContain('amit_verma');
  });

  it('should include current user if not yet in roster but authorized for household', () => {
    mockMembersSignal.set([
      {
        id: 'hm-2',
        household_id: 'mock-hh-02',
        user_id: 'user-kiran',
        role_in_household: 'member',
        username: 'kiran_manager',
        fullName: 'Kiran Manager'
      }
    ]);

    // Current user is Amit Verma, who is authorized for mock-hh-02
    const members = component.currentMembers();
    expect(members.length).toBe(2);
    expect(members.some(m => m.user_id === 'user-verma')).toBeTrue();
    expect(members.some(m => m.user_id === 'user-kiran')).toBeTrue();
  });
});
