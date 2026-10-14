export interface CustomerProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  lastLoginAt?: string | null;
}

const SESSION_KEY = 'express-bank-customer';

export function saveCustomerSession(customer: CustomerProfile) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(customer));
}

export function loadCustomerSession(): CustomerProfile | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  try {
    const customer = JSON.parse(stored) as Partial<CustomerProfile>;
    if (!customer.id || !customer.email || !customer.firstName || !customer.lastName) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return customer as CustomerProfile;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearCustomerSession() {
  localStorage.removeItem(SESSION_KEY);
}
