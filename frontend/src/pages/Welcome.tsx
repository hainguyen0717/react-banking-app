import { Navigate } from 'react-router-dom';
import { loadCustomerSession } from '../lib/session';

export function Welcome() {
  return <Navigate to={loadCustomerSession() ? '/dashboard' : '/'} replace />;
}

export default Welcome;
