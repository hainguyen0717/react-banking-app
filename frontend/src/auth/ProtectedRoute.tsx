import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { DelayBlocker } from '../components/DelayBlocker';
import styles from './ProtectedRoute.module.css';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return (
      <div className={styles.loadingBoundary} data-testid="auth-session-loading-boundary">
        <p role="status" data-testid="auth-session-loading">Checking your session…</p>
        <DelayBlocker testIdPrefix="auth-session-delay-blocker" />
      </div>
    );
  }
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
