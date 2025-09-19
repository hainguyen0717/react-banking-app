import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Login.module.css';

interface LoginResponse {
  token: string;
  customerId: string;
  customerName: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export function CustomerLogin() {
  const navigate = useNavigate();
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
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: trimmedUsername,
          password
        })
      });

      const data: Partial<LoginResponse> & { message?: string } | null = await response
        .json()
        .catch(() => null);

      if (!response.ok || !data) {
        const message = data?.message ?? 'Incorrect username/password or user does not exist.';
        setError(message);
        return;
      }

      if (!data.customerName) {
        setError('Unable to complete login. Please try again.');
        return;
      }

      const firstName = data.customerName.trim().split(/\s+/)[0] || data.customerName;

      navigate('/welcome', { state: { firstName } });
    } catch (err) {
      setError('Unable to connect to Express Bank. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <h1 data-testid="customer-login-header" className={styles.heading}>
          Customer Online Banking
        </h1>
        {error ? (
          <p className={styles.error} role="alert" aria-live="assertive">
            {error}
          </p>
        ) : null}
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.label} htmlFor="username">
            Username
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="email"
              className={styles.input}
              placeholder="Enter your username"
              data-testid="customer-login-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </label>
          <label className={styles.label} htmlFor="password">
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
        <nav className={styles.links} aria-label="Helpful links">
          <a className={styles.link} href="#" data-testid="customer-login-forgot-username-link">
            Forgot username?
          </a>
          <a className={styles.link} href="#" data-testid="customer-login-enroll-link">
            Enroll in online banking
          </a>
        </nav>
      </section>
    </div>
  );
}

export default CustomerLogin;
