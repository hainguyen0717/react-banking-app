import { Navigate, useLocation } from 'react-router-dom';
import styles from './Welcome.module.css';

interface WelcomeLocationState {
  firstName?: string;
}

export function Welcome() {
  const location = useLocation();
  const state = (location.state as WelcomeLocationState | null) ?? {};
  const firstName = state.firstName?.trim();

  if (!firstName) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.hero}>
        <h1 className={styles.title}>Welcome to Express Bank {firstName}</h1>
        <p className={styles.subtitle}>
          You are now securely signed in. Access your accounts, track your balances, and manage your finances with ease.
        </p>
      </header>
    </div>
  );
}

export default Welcome;
