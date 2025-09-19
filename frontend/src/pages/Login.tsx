import styles from './Login.module.css';

export function CustomerLogin() {
  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <h1 data-testid="customer-login-header" className={styles.heading}>
          Customer Online Banking
        </h1>
        <form className={styles.form}>
          <label className={styles.label} htmlFor="username">
            Username
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              className={styles.input}
              placeholder="Enter your username"
              data-testid="customer-login-username"
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
            />
          </label>
          <button type="submit" className={styles.button} data-testid="customer-login-submit">
            Log In
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
