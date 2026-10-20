import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';

export default function Index() {
  const { state } = useAuth();
  if (state.status === 'signedIn') return <Redirect href="/(app)/dashboard" />;
  return <Redirect href="/auth" />;
}
