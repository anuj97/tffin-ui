import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HouseholdService } from '../../core/services/household.service';
import { MealStoreService } from '../../core/services/meal-store.service';
import { AuthService } from '../../core/services/auth.service';
import { Household, HouseholdMember, HouseholdInvitation, HouseholdMemberRole } from '../../core/models/household.model';

@Component({
  selector: 'app-household-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './household-management.html',
  styleUrl: './household-management.scss'
})
export class HouseholdManagementComponent implements OnInit {
  public householdService = inject(HouseholdService);
  public store = inject(MealStoreService);
  public auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  public currentUser = this.auth.currentUser;
  public activeHouseholds = this.householdService.activeHouseholds;
  public selectedHouseholdId = signal<string>('');

  // Selected Household computed
  public currentHousehold = computed<Household | null>(() => {
    const id = this.selectedHouseholdId();
    if (!id) return this.activeHouseholds()[0] || null;
    return this.householdService.householdsMap().get(id) || this.activeHouseholds()[0] || null;
  });

  // Current Household Members
  public currentMembers = computed<HouseholdMember[]>(() => {
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return [];
    const roster = this.householdService.householdMembers().filter(m => m.household_id === hhId);
    const result = [...roster];

    // Ensure the current user is included alongside other members if they are part of this household
    const u = this.currentUser();
    if (u && (u.household_id === hhId || u.household_ids?.includes(hhId) || this.householdService.authorizedHouseholdIds().has(hhId))) {
      if (!result.some(m => m.user_id === u.id)) {
        const role = this.householdService.getRoleInHousehold(hhId) || 'owner';
        result.unshift({
          id: `current-${u.id}`,
          household_id: hhId,
          user_id: u.id,
          role_in_household: role,
          created_at: u.created_at || new Date().toISOString(),
          username: u.username,
          fullName: u.fullName || u.username,
          email: u.email
        });
      }
    }

    return result;
  });

  // Current Household Invitations
  public currentInvitations = computed<HouseholdInvitation[]>(() => {
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return [];
    return this.householdService.householdInvitations().filter(i => i.household_id === hhId);
  });

  public pendingInvitations = computed<HouseholdInvitation[]>(() => {
    return this.currentInvitations().filter(i => i.status === 'pending');
  });

  public hasNoHouseholds = computed<boolean>(() => {
    return this.activeHouseholds().length === 0;
  });

  // Permission Check using HouseholdService
  public canManage = computed<boolean>(() => {
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return false;
    return this.householdService.canManage(hhId);
  });

  // Invite Modal State
  public isInviteModalOpen = signal<boolean>(false);
  public inviteRole = signal<HouseholdMemberRole>('member');
  public inviteEmail = signal<string>('');
  public inviteExpiryDays = signal<number>(7);
  public generatedInvite = signal<HouseholdInvitation | null>(null);
  public copiedInviteLink = signal<boolean>(false);
  public isCreatingInvite = signal<boolean>(false);

  // Manual Join Modal State
  public isJoinModalOpen = signal<boolean>(false);
  public joinCodeInput = signal<string>('');
  public isJoining = signal<boolean>(false);
  public joinError = signal<string | null>(null);

  // Create Household Modal State
  public isCreateModalOpen = signal<boolean>(false);
  public createName = signal<string>('');
  public createCode = signal<string>('');
  public createContactName = signal<string>('');
  public createContactPhone = signal<string>('');
  public createAddress = signal<string>('');
  public createHeadcount = signal<number>(2);
  public createDietaryNotes = signal<string>('');
  public createColorTag = signal<string>('#6366f1');
  public isCreatingHousehold = signal<boolean>(false);

  // Edit Household Modal State
  public isEditModalOpen = signal<boolean>(false);
  public editName = signal<string>('');
  public editCode = signal<string>('');
  public editContactName = signal<string>('');
  public editContactPhone = signal<string>('');
  public editAddress = signal<string>('');
  public editHeadcount = signal<number>(2);
  public editDietaryNotes = signal<string>('');
  public editColorTag = signal<string>('#6366f1');

  // Delete Household Modal State
  public isDeleteModalOpen = signal<boolean>(false);
  public isDeleting = signal<boolean>(false);

  constructor() {
    // Reactively ensure selectedHouseholdId tracks effectiveHouseholdId or first active household
    effect(() => {
      const effId = this.householdService.effectiveHouseholdId();
      const currentSelected = this.selectedHouseholdId();
      const authed = this.householdService.authorizedHouseholdIds();
      if (effId && (!currentSelected || !authed.has(currentSelected))) {
        untracked(() => {
          this.selectedHouseholdId.set(effId);
        });
      } else if (!currentSelected && this.activeHouseholds().length > 0) {
        untracked(() => {
          this.selectedHouseholdId.set(this.activeHouseholds()[0].id);
        });
      }
    });

    // Reactively ensure members and invitations are loaded for currentHousehold
    effect(() => {
      const hh = this.currentHousehold();
      if (hh?.id) {
        untracked(() => {
          this.householdService.loadHouseholdMembers(hh.id);
          this.householdService.loadHouseholdInvitations(hh.id);
        });
      }
    });
  }

  public ngOnInit(): void {
    // Initial household selection
    const initialHhId = this.householdService.effectiveHouseholdId() || this.activeHouseholds()[0]?.id || '';
    this.selectedHouseholdId.set(initialHhId);

    if (initialHhId) {
      this.householdService.loadHouseholdMembers(initialHhId);
      this.householdService.loadHouseholdInvitations(initialHhId);
    }

    // Check for '?join=CODE' query parameter
    const joinCode = this.route.snapshot.queryParams['join'];
    if (joinCode) {
      this.joinCodeInput.set(joinCode);
      this.isJoinModalOpen.set(true);
    }
  }

  public selectHousehold(id: string): void {
    this.selectedHouseholdId.set(id);
    this.householdService.setSelectedHousehold(id);
    this.householdService.loadHouseholdMembers(id);
    this.householdService.loadHouseholdInvitations(id);
  }

  // Invite Management
  public openInviteModal(): void {
    this.inviteRole.set('member');
    this.inviteEmail.set('');
    this.inviteExpiryDays.set(7);
    this.generatedInvite.set(null);
    this.copiedInviteLink.set(false);
    this.isInviteModalOpen.set(true);
  }

  public closeInviteModal(): void {
    this.isInviteModalOpen.set(false);
    this.generatedInvite.set(null);
  }

  public async generateInvite(): Promise<void> {
    const hh = this.currentHousehold();
    if (!hh) return;

    this.isCreatingInvite.set(true);
    try {
      const inv = await this.householdService.createInviteLink(
        hh.id,
        this.inviteRole(),
        this.inviteEmail().trim() || undefined,
        this.inviteExpiryDays()
      );
      this.generatedInvite.set(inv);
    } catch (e) {
      console.error(e);
    } finally {
      this.isCreatingInvite.set(false);
    }
  }

  public getInviteUrl(code: string): string {
    const origin = window.location.origin;
    return `${origin}/households?join=${code}`;
  }

  public async copyInviteLink(code: string): Promise<void> {
    const url = this.getInviteUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      this.copiedInviteLink.set(true);
      setTimeout(() => this.copiedInviteLink.set(false), 2500);
      this.store.showNotification('Invite link copied to clipboard!', 'info');
    } catch {
      this.store.showNotification(`Invite Code: ${code}`, 'info');
    }
  }

  public async revokeInvite(id: string): Promise<void> {
    await this.householdService.revokeInvite(id);
  }

  public async removeMember(userId: string, memberName: string): Promise<void> {
    const hh = this.currentHousehold();
    if (!hh) return;

    if (confirm(`Are you sure you want to remove ${memberName} from ${hh.name}?`)) {
      await this.householdService.removeMember(hh.id, userId);
    }
  }

  // Join Modal
  public openJoinModal(): void {
    this.joinCodeInput.set('');
    this.joinError.set(null);
    this.isJoinModalOpen.set(true);
  }

  public closeJoinModal(): void {
    this.isJoinModalOpen.set(false);
    this.joinError.set(null);
  }

  public async submitJoinCode(): Promise<void> {
    const code = this.joinCodeInput().trim();
    if (!code) {
      this.joinError.set('Please enter a valid invite code');
      return;
    }

    this.isJoining.set(true);
    this.joinError.set(null);

    const res = await this.householdService.acceptInviteCode(code);
    this.isJoining.set(false);

    if (res.success && res.household_id) {
      this.closeJoinModal();
      this.selectHousehold(res.household_id);
      // Remove query param from URL
      this.router.navigate([], { queryParams: {} });
    } else {
      this.joinError.set(res.message);
    }
  }

  // Edit Household Profile
  public openEditModal(): void {
    const hh = this.currentHousehold();
    if (!hh) return;

    this.editName.set(hh.name);
    this.editCode.set(hh.code || '');
    this.editContactName.set(hh.contact_name || '');
    this.editContactPhone.set(hh.contact_phone || '');
    this.editAddress.set(hh.address || '');
    this.editHeadcount.set(hh.default_headcount || 2);
    this.editDietaryNotes.set(hh.dietary_notes || '');
    this.editColorTag.set(hh.color_tag || '#6366f1');
    this.isEditModalOpen.set(true);
  }

  public closeEditModal(): void {
    this.isEditModalOpen.set(false);
  }

  public async saveHouseholdEdit(): Promise<void> {
    const hh = this.currentHousehold();
    if (!hh) return;

    const name = this.editName().trim();
    if (!name) return;

    await this.householdService.updateHousehold(hh.id, {
      name,
      code: this.editCode().trim() || undefined,
      contact_name: this.editContactName().trim() || undefined,
      contact_phone: this.editContactPhone().trim() || undefined,
      address: this.editAddress().trim() || undefined,
      default_headcount: Number(this.editHeadcount()) || 2,
      dietary_notes: this.editDietaryNotes().trim() || undefined,
      color_tag: this.editColorTag() || '#6366f1'
    });

    this.closeEditModal();
  }

  // Create Household
  public openCreateModal(): void {
    const user = this.currentUser();
    this.createName.set('');
    this.createCode.set('');
    this.createContactName.set(user?.fullName || '');
    this.createContactPhone.set('');
    this.createAddress.set('');
    this.createHeadcount.set(2);
    this.createDietaryNotes.set('');
    this.createColorTag.set('#6366f1');
    this.isCreateModalOpen.set(true);
  }

  public closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  public async submitCreateHousehold(): Promise<void> {
    const name = this.createName().trim();
    if (!name) return;

    this.isCreatingHousehold.set(true);
    try {
      const created = await this.householdService.createHousehold({
        name,
        code: this.createCode().trim() || undefined,
        contact_name: this.createContactName().trim() || undefined,
        contact_phone: this.createContactPhone().trim() || undefined,
        address: this.createAddress().trim() || undefined,
        default_headcount: Number(this.createHeadcount()) || 2,
        dietary_notes: this.createDietaryNotes().trim() || undefined,
        color_tag: this.createColorTag() || '#6366f1',
        is_active: true
      });

      if (created) {
        this.closeCreateModal();
        this.selectHousehold(created.id);
      }
    } finally {
      this.isCreatingHousehold.set(false);
    }
  }

  // Delete Household
  public openDeleteModal(): void {
    this.isDeleteModalOpen.set(true);
  }

  public closeDeleteModal(): void {
    this.isDeleteModalOpen.set(false);
  }

  public async confirmDeleteHousehold(): Promise<void> {
    const hh = this.currentHousehold();
    if (!hh) return;

    this.isDeleting.set(true);
    try {
      const success = await this.householdService.deleteHousehold(hh.id);
      if (success) {
        this.closeDeleteModal();
        if (this.isEditModalOpen()) {
          this.closeEditModal();
        }
        const remaining = this.activeHouseholds().filter(h => h.id !== hh.id);
        if (remaining.length > 0) {
          this.selectHousehold(remaining[0].id);
        } else {
          this.selectedHouseholdId.set('');
          this.router.navigate(['/dashboard']);
        }
      }
    } finally {
      this.isDeleting.set(false);
    }
  }
}
