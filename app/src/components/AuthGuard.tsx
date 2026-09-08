import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ShieldAlert } from 'lucide-react';

interface AuthGuardProps {
  children?: ReactNode;
  allowedRoles?: string[];
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-bg-base text-text-primary">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="size-10 animate-spin rounded-full border-2 border-iris/20 border-t-iris" />
          <div className="font-mono text-xs text-text-muted tracking-wider uppercase">
            Verifying Session Security…
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
        <div className="rounded-full bg-risk/10 p-4 text-risk">
          <ShieldAlert className="size-8" />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-text-primary">
          Access Restricted
        </h2>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Your current role (<span className="font-mono text-text-accent uppercase">{user.role}</span>) does not have permission to view this resource. Contact an administrator to adjust your workspace permissions.
        </p>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
}

export default AuthGuard;
