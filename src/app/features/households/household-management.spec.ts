import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { HouseholdManagementComponent } from './household-management';
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

  const mockStore = {
    activeHouseholds: signal(mockHouseholds),
    effectiveHouseholdId: signal('mock-hh-02'),
    householdsMap: signal(new Map([['mock-hh-02', mockHouseholds[0]]])),
    householdMembers: mockMembersSignal,
    householdInvitations: mockInvitationsSignal,
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
    showNotification: jasmine.createSpy('showNotification')
  };

  const mockAuth = {
    currentUser: mockUserSignal
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HouseholdManagementComponent],
      providers: [
        provideRouter([]),
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
    expect(mockStore.createInviteLink).toHaveBeenCalled();
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

    expect(mockStore.acceptInviteCode).toHaveBeenCalledWith('TFFN-TEST01');
    expect(component.isJoinModalOpen()).toBeFalse();
  });
});
