import { Injectable, signal } from '@angular/core';

export interface AppNotification {
  message: string;
  type: 'success' | 'info' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  public notification = signal<AppNotification | null>(null);
  private timeoutId: any = null;

  public show(message: string, type: 'success' | 'info' | 'error' = 'info', durationMs: number = 4000): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.notification.set({ message, type });
    this.timeoutId = setTimeout(() => {
      this.notification.set(null);
      this.timeoutId = null;
    }, durationMs);
  }

  public clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.notification.set(null);
  }
}
