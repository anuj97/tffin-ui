import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LumberjackService } from '@ngworker/lumberjack';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const lumberjack = inject(LumberjackService);

  if (auth.isAuthenticated()) {
    lumberjack.logDebug(
      `Access granted for protected route: ${state.url}`,
      {
        user: auth.currentUser()?.username,
        role: auth.currentUser()?.role
      },
      'AuthGuard'
    );
    return true;
  }

  lumberjack.logWarning(
    `Unauthenticated access blocked for route: ${state.url}. Redirecting to /login`,
    { targetUrl: state.url },
    'AuthGuard'
  );

  // Redirect to /login with returnUrl parameter
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url }
  });
};
