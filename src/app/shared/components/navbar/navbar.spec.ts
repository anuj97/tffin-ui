import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NavbarComponent } from './navbar';
import { HouseholdService } from '../../../core/services/household.service';
import { MealStoreService } from '../../../core/services/meal-store.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AppUser } from '../../../core/models/user.model';
import { Household } from '../../../core/models/household.model';

describe('NavbarComponent (Hamburger Menu)', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;

  const mockUserSignal = signal<AppUser | null>({
    id: 'user-admin',
    username: 'admin',
    role: 'admin',
    fullName: 'Admin User',
    household_ids: []
  });

  const mockAuthService = {
    currentUser: mockUserSignal,
    isLocalDebug: signal<boolean>(false),
    logout: jasmine.createSpy('logout')
  };

  const mockHouseholdsSignal = signal<Household[]>([
    { id: 'mock-hh-01', name: 'Main Household', is_active: true, default_headcount: 3 },
    { id: 'mock-hh-02', name: 'Verma Residence', is_active: true, default_headcount: 4 }
  ]);

  const mockHouseholdService = {
    households: mockHouseholdsSignal,
    activeHouseholds: mockHouseholdsSignal,
    authorizedHouseholds: mockHouseholdsSignal,
    selectedHouseholdId: signal<string | null>(null),
    isSingleHouseholdUser: signal(false),
    singleHousehold: signal(null),
    canManageAnyHousehold: jasmine.createSpy('canManageAnyHousehold').and.returnValue(true),
    householdsMap: signal(new Map<string, Household>([
      ['mock-hh-01', { id: 'mock-hh-01', name: 'Main Household', is_active: true, default_headcount: 3 }],
      ['mock-hh-02', { id: 'mock-hh-02', name: 'Verma Residence', is_active: true, default_headcount: 4 }]
    ])),
    setSelectedHousehold: jasmine.createSpy('setSelectedHousehold'),
    createHousehold: jasmine.createSpy('createHousehold'),
    toggleHouseholdActive: jasmine.createSpy('toggleHouseholdActive'),
    deleteHousehold: jasmine.createSpy('deleteHousehold')
  };

  const mockStoreService = {
    households: mockHouseholdsSignal,
    activeHouseholds: mockHouseholdsSignal,
    authorizedHouseholds: mockHouseholdsSignal,
    selectedHouseholdId: signal<string | null>(null),
    householdsMap: signal(new Map<string, Household>([
      ['mock-hh-01', { id: 'mock-hh-01', name: 'Main Household', is_active: true, default_headcount: 3 }],
      ['mock-hh-02', { id: 'mock-hh-02', name: 'Verma Residence', is_active: true, default_headcount: 4 }]
    ])),
    lowStockCount: signal<number>(2),
    showNotification: jasmine.createSpy('showNotification'),
    setSelectedHousehold: jasmine.createSpy('setSelectedHousehold'),
    loadMockData: jasmine.createSpy('loadMockData'),
    notification: signal(null)
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: MealStoreService, useValue: mockStoreService },
        {
          provide: SupabaseService,
          useValue: { hasClient: false }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize with hamburger sidebar drawer closed', () => {
    expect(component.isSidebarOpen()).toBeFalse();
  });

  it('should toggle sidebar open and closed', () => {
    component.toggleSidebar();
    expect(component.isSidebarOpen()).toBeTrue();

    component.toggleSidebar();
    expect(component.isSidebarOpen()).toBeFalse();
  });

  it('should close sidebar on escape key when open', () => {
    component.openSidebar();
    expect(component.isSidebarOpen()).toBeTrue();

    component.onEscape();
    expect(component.isSidebarOpen()).toBeFalse();
  });

  it('should correctly identify admin permissions for managing households', () => {
    expect(component.canManageHouseholds()).toBeTrue();
  });
});
