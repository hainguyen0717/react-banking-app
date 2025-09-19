import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomerLogin } from './Login';

describe('CustomerLogin', () => {
  it('renders the login header, form fields, button, and links with data-testids', () => {
    render(
      <MemoryRouter>
        <CustomerLogin />
      </MemoryRouter>
    );

    expect(screen.getByTestId('customer-login-header')).toHaveTextContent('Customer Online Banking');
    expect(screen.getByTestId('customer-login-username')).toBeInTheDocument();
    expect(screen.getByTestId('customer-login-password')).toBeInTheDocument();
    expect(screen.getByTestId('customer-login-submit')).toHaveTextContent('Log In');
    expect(screen.getByTestId('customer-login-forgot-username-link')).toHaveAttribute('href', '#');
    expect(screen.getByTestId('customer-login-enroll-link')).toHaveAttribute('href', '#');
  });
});
