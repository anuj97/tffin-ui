import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  public auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  public username = signal<string>('');
  public password = signal<string>('');
  public rememberMe = signal<boolean>(true);
  public showPassword = signal<boolean>(false);
  public errorMessage = signal<string | null>(null);

  constructor() {
    // If already logged in, redirect directly to dashboard
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  public async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);

    const userVal = this.username().trim();
    const passVal = this.password();

    if (!userVal || !passVal) {
      this.errorMessage.set('Please enter both username and password.');
      return;
    }

    const res = await this.auth.login(userVal, passVal, this.rememberMe());

    if (res.success) {
      const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
      this.router.navigateByUrl(returnUrl);
    } else {
      this.errorMessage.set(res.error || 'Authentication failed. Please verify credentials.');
    }
  }

  public togglePasswordVisibility(): void {
    this.showPassword.set(!this.showPassword());
  }
}
