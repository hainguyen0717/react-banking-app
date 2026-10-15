export interface CustomerProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  address?: string | null;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  lastLoginAt?: string | null;
}

export function clearLegacyCustomerSession() {
  localStorage.removeItem('express-bank-customer');
}
