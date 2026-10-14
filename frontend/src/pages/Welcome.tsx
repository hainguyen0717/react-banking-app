import { Navigate } from 'react-router-dom';

export function Welcome() {
  return <Navigate to="/dashboard" replace />;
}

export default Welcome;
