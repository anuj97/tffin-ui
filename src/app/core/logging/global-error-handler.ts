import { ErrorHandler, Injectable, NgZone, inject } from '@angular/core';
import { LumberjackService } from '@ngworker/lumberjack';
import { NotificationService } from '../services/notification.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private lumberjack = inject(LumberjackService);
  private notifications = inject(NotificationService);
  private zone = inject(NgZone);

  private lastNotificationTime = 0;
  private readonly notificationDebounceMs = 3000;

  public handleError(error: any): void {
    const errorMessage = error?.message || error?.toString?.() || 'Unknown application error';
    const errorStack = error?.stack;

    this.lumberjack.logError(
      `Uncaught exception: ${errorMessage}`,
      {
        error: {
          name: error?.name || 'Error',
          message: errorMessage,
          stack: errorStack
        },
        url: typeof window !== 'undefined' ? window.location.href : '',
        timestamp: new Date().toISOString()
      },
      'GlobalErrorHandler'
    );

    // Display rate-limited toast notification to user
    const now = Date.now();
    if (now - this.lastNotificationTime > this.notificationDebounceMs) {
      this.lastNotificationTime = now;
      this.zone.run(() => {
        this.notifications.show('An unexpected error occurred. Please refresh or try again.', 'error', 5000);
      });
    }
  }
}
