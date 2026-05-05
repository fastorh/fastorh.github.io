import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface Props {
  children: React.ReactNode;
  redirectTo?: string;
}

export function ProtectedRoute({ children, redirectTo = '/login' }: Props) {
  const { isLoading, isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) {
    return <Navigate to={`${redirectTo}?returnUrl=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export function PublicOnlyRoute({ children, redirectTo = '/dashboard' }: Props) {
  const { isLoading, isAuthenticated } = useAuthStore();

  if (isLoading) return <Spinner />;
  if (isAuthenticated) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
