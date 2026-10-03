import { Injectable, inject, signal } from '@angular/core';
import { LumberjackService } from '@ngworker/lumberjack';

export interface AppNotification {
  message: string;
  type: 'success' | 'info' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private lumberjack = inject(LumberjackService);
  public notification = signal<AppNotification | null>(null);
  private timeoutId: any = null;

  public show(message: string, type: 'success' | 'info' | 'error' = 'info', durationMs: number = 4000): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    if (type === 'error') {
      this.lumberjack.logWarning(`Displaying error notification: "${message}"`, undefined, 'NotificationService');
    } else {
      this.lumberjack.logInfo(`Displaying ${type} notification: "${message}"`, undefined, 'NotificationService');
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
