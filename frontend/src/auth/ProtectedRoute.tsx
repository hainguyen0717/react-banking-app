import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <p role="status" data-testid="auth-session-loading">Checking your session…</p>;
  if (auth.status === 'error') {
    return (
      <section data-testid="auth-session-error">
        <p role="alert" data-testid="auth-session-error-message">{auth.error}</p>
        <button type="button" onClick={() => void auth.retry()} data-testid="auth-session-retry">Retry</button>
      </section>
    );
  }
  if (auth.status === 'anonymous') return <Navigate to="/" replace />;
  return children;
}
