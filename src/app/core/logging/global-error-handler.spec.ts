import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { LumberjackService } from '@ngworker/lumberjack';
import { GlobalErrorHandler } from './global-error-handler';
import { NotificationService } from '../services/notification.service';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let mockLumberjack: jasmine.SpyObj<LumberjackService>;
  let mockNotifications: jasmine.SpyObj<NotificationService>;
  let ngZone: NgZone;

  beforeEach(() => {
    mockLumberjack = jasmine.createSpyObj('LumberjackService', ['logError']);
    mockNotifications = jasmine.createSpyObj('NotificationService', ['show']);

    TestBed.configureTestingModule({
      providers: [
        GlobalErrorHandler,
        { provide: LumberjackService, useValue: mockLumberjack },
        { provide: NotificationService, useValue: mockNotifications }
      ]
    });

    handler = TestBed.inject(GlobalErrorHandler);
  });

  it('should intercept uncaught exceptions and log them with LumberjackService', () => {
    const error = new Error('Test uncaught error');

    handler.handleError(error);

    expect(mockLumberjack.logError).toHaveBeenCalledWith(
      'Uncaught exception: Test uncaught error',
      jasmine.objectContaining({
        error: jasmine.objectContaining({ message: 'Test uncaught error' }),
        timestamp: jasmine.any(String)
      }),
      'GlobalErrorHandler'
    );
  });

  it('should trigger a notification on uncaught exception', () => {
    const error = new Error('Test toast error');

    handler.handleError(error);

    expect(mockNotifications.show).toHaveBeenCalledWith(
      'An unexpected error occurred. Please refresh or try again.',
      'error',
      5000
    );
  });

  it('should debounce notification calls to prevent user spam within 3 seconds', () => {
    const error1 = new Error('First crash');
    const error2 = new Error('Second crash');

    handler.handleError(error1);
    handler.handleError(error2);

    expect(mockLumberjack.logError).toHaveBeenCalledTimes(2);
    expect(mockNotifications.show).toHaveBeenCalledTimes(1);
  });

  it('should show notification again after debounce window expires', () => {
    const error1 = new Error('First crash');
    const error2 = new Error('Second crash after delay');

    jasmine.clock().install();
    const baseTime = Date.now();
    jasmine.clock().mockDate(new Date(baseTime));

    handler.handleError(error1);
    expect(mockNotifications.show).toHaveBeenCalledTimes(1);

    // Fast-forward 3.5 seconds
    jasmine.clock().mockDate(new Date(baseTime + 3500));
    handler.handleError(error2);

    expect(mockNotifications.show).toHaveBeenCalledTimes(2);

    jasmine.clock().uninstall();
  });
});
