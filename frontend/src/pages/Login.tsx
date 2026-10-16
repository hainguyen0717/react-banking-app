import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DelayBlocker } from '../components/DelayBlocker';
import { useDelayActivity } from '../lib/delayActivity';
import styles from './Login.module.css';

export function CustomerLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const delayActivity = useDelayActivity();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError('Incorrect username/password or user does not exist.');
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await auth.login(trimmedUsername, password);
      if (!data.id || !data.firstName || !data.email || !data.lastName) {
        setError('Unable to complete login. Please try again.');
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      console.error('Customer login request failed to reach the API.', err);
      setError(err instanceof Error ? err.message : 'Unable to connect to Express Bank. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrapper} data-testid="customer-login-page">
      <section className={styles.card} aria-busy={delayActivity.active || undefined} data-testid="customer-login-card">
        <div className={styles.cardContent} {...(delayActivity.active ? { inert: '' } : {})} data-testid="customer-login-card-content">
          <div className={styles.brand} data-testid="customer-login-brand">EXPRESS / BANK</div>
          <p className={styles.eyebrow} data-testid="customer-login-eyebrow">Customer access</p>
          <h1 data-testid="customer-login-header" className={styles.heading}>
            Banking that stays clear.
          </h1>
          <p className={styles.intro} data-testid="customer-login-intro">
            Sign in to view accounts, transfer funds and inspect transaction history.
          </p>
          {(location.state as { registered?: boolean } | null)?.registered ? (
            <p className={styles.success} role="status" data-testid="customer-login-registration-success">
              Customer created. You can now sign in.
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert" aria-live="assertive" data-testid="customer-login-error">
              {error}
            </p>
          ) : null}
          <form className={styles.form} onSubmit={handleSubmit} noValidate data-testid="customer-login-form">
            <label className={styles.label} htmlFor="username" data-testid="customer-login-email-label">
              Email
              <input
                id="username"
                name="username"
                type="email"
                autoComplete="email"
                className={styles.input}
                placeholder="name@example.com"
                data-testid="customer-login-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                aria-invalid={Boolean(error)}
              />
            </label>
            <label className={styles.label} htmlFor="password" data-testid="customer-login-password-label">
              Password
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className={styles.input}
                placeholder="Enter your password"
                data-testid="customer-login-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className={styles.button}
              data-testid="customer-login-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing In…' : 'Log In'}
            </button>
          </form>
          <p className={styles.registerPrompt} data-testid="customer-login-register-prompt">
            New to Express Bank?{' '}
            <Link className={styles.link} to="/register" data-testid="customer-login-register-link">
              Create a customer
            </Link>
          </p>
        </div>
        <DelayBlocker testIdPrefix="login-delay-blocker" />
      </section>
    </div>
  );
}

export default CustomerLogin;
