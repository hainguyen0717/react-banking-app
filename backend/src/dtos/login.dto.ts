export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  token: string;
  customerId: string;
  customerName: string;
}

export function validateLoginRequest(payload: unknown): LoginRequestDto {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Request body must be an object.');
  }

  const { email, password } = payload as Record<string, unknown>;

  if (typeof email !== 'string' || !email.trim()) {
    throw new Error('Email is required.');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw new Error('Email must be a valid email address.');
  }

  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  return { email: email.trim().toLowerCase(), password };
}
