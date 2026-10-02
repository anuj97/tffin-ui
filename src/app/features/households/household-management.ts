import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
  public store = inject(MealStoreService);
  public auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  public currentUser = this.auth.currentUser;
  public activeHouseholds = this.store.activeHouseholds;
  public selectedHouseholdId = signal<string>('');

  // Selected Household computed
  public currentHousehold = computed<Household | null>(() => {
    const id = this.selectedHouseholdId();
    if (!id) return this.activeHouseholds()[0] || null;
    return this.store.householdsMap().get(id) || this.activeHouseholds()[0] || null;
  });

  // Current Household Members
  public currentMembers = computed<HouseholdMember[]>(() => {
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return [];
    return this.store.householdMembers().filter(m => m.household_id === hhId);
  });

  // Current Household Invitations
  public currentInvitations = computed<HouseholdInvitation[]>(() => {
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return [];
    return this.store.householdInvitations().filter(i => i.household_id === hhId);
  });

  public pendingInvitations = computed<HouseholdInvitation[]>(() => {
    return this.currentInvitations().filter(i => i.status === 'pending');
  });

  // Permission Check
  public canManage = computed<boolean>(() => {
    const u = this.currentUser();
    if (!u) return false;
    if (['admin', 'owner'].includes(u.role)) return true;
    const hhId = this.currentHousehold()?.id;
    if (!hhId) return false;
    const membership = this.currentMembers().find(m => m.user_id === u.id);
    return membership?.role_in_household === 'owner';
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

  public ngOnInit(): void {
    // Initial household selection
    const initialHhId = this.store.effectiveHouseholdId() || this.activeHouseholds()[0]?.id || '';
    this.selectedHouseholdId.set(initialHhId);

    if (initialHhId) {
      this.store.loadHouseholdMembers(initialHhId);
      this.store.loadHouseholdInvitations(initialHhId);
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
    this.store.setSelectedHousehold(id);
    this.store.loadHouseholdMembers(id);
    this.store.loadHouseholdInvitations(id);
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
      const inv = await this.store.createInviteLink(
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
    await this.store.revokeInvite(id);
  }

  public async removeMember(userId: string, memberName: string): Promise<void> {
    const hh = this.currentHousehold();
    if (!hh) return;

    if (confirm(`Are you sure you want to remove ${memberName} from ${hh.name}?`)) {
      await this.store.removeMember(hh.id, userId);
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

    const res = await this.store.acceptInviteCode(code);
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

    await this.store.updateHousehold(hh.id, {
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
}
