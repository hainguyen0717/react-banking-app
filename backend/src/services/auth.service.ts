import { customers } from '../data/customers';
import { LoginResponseDto } from '../dtos/login.dto';
import { HttpError } from '../errors/HttpError';
import { generateToken, verifyPassword } from '../utils/security';

export class AuthService {
  validateCredentials(email: string, password: string): LoginResponseDto {
    const customer = customers.find((record) => record.email === email);

    if (!customer) {
      throw new HttpError(401, 'Invalid credentials.');
    }

    const isValid = verifyPassword(password, customer.passwordHash);

    if (!isValid) {
      throw new HttpError(401, 'Invalid credentials.');
    }

    return {
      token: generateToken(customer.id),
      customerId: customer.id,
      customerName: customer.fullName
    };
  }
}
