import { hashPassword } from '../utils/security';

export interface CustomerRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
}

interface SeedCustomer {
  id: string;
  email: string;
  fullName: string;
  password: string;
}

const seeds: SeedCustomer[] = [
  {
    id: 'cust-1001',
    email: 'jane.doe@example.com',
    fullName: 'Jane Doe',
    password: 'Sup3rSecret!'
  },
  {
    id: 'cust-1002',
    email: 'john.smith@example.com',
    fullName: 'John Smith',
    password: 'BankingR0cks'
  }
];

export const customers: CustomerRecord[] = seeds.map((seed) => ({
  id: seed.id,
  email: seed.email,
  fullName: seed.fullName,
  passwordHash: hashPassword(seed.password)
}));
