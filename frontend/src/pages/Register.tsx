import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { CustomerProfile } from '../lib/session';
import styles from './Login.module.css';

export function Register() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await apiRequest<CustomerProfile>('/api/customers', {
        method: 'POST',
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      navigate('/', { state: { registered: true } });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Customer could not be created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.wrapper} data-testid="customer-create-page">
      <section className={styles.card} data-testid="customer-create-card">
        <div className={styles.cardContent} data-testid="customer-create-card-content">
          <div className={styles.brand} data-testid="customer-create-brand">EXPRESS / BANK</div>
          <p className={styles.eyebrow} data-testid="customer-create-eyebrow">New customer</p>
          <h1 className={styles.heading} data-testid="customer-create-header">Create your profile.</h1>
          <p className={styles.intro} data-testid="customer-create-intro">
            Use a test identity. You can add an account after signing in.
          </p>
          {error ? <p className={styles.error} role="alert" data-testid="customer-create-error">{error}</p> : null}
          <form className={styles.form} onSubmit={handleSubmit} data-testid="customer-create-form">
            <label className={styles.label} htmlFor="firstName" data-testid="customer-create-first-name-label">
              First name
              <input className={styles.input} id="firstName" name="firstName" autoComplete="given-name" required data-testid="customer-create-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label className={styles.label} htmlFor="lastName" data-testid="customer-create-last-name-label">
              Last name
              <input className={styles.input} id="lastName" name="lastName" autoComplete="family-name" required data-testid="customer-create-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
            <label className={styles.label} htmlFor="registerEmail" data-testid="customer-create-email-label">
              Email
              <input className={styles.input} id="registerEmail" name="email" type="email" autoComplete="email" required data-testid="customer-create-email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className={styles.label} htmlFor="registerPassword" data-testid="customer-create-password-label">
              Password
              <input className={styles.input} id="registerPassword" name="password" type="password" autoComplete="new-password" minLength={8} required data-testid="customer-create-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <p className={styles.helper} data-testid="customer-create-password-helper">Use at least 8 characters.</p>
            <button className={styles.button} type="submit" disabled={isSubmitting} data-testid="customer-create-submit">
              {isSubmitting ? 'Creating customer…' : 'Create customer'}
            </button>
          </form>
          <p className={styles.registerPrompt} data-testid="customer-create-login-prompt">
            Already have a profile?{' '}
            <Link className={styles.link} to="/" data-testid="customer-create-login-link">Return to login</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

export default Register;
