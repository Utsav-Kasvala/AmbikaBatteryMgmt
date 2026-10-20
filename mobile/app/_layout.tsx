import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { queryClient } from '../src/api/queryClient';
import { theme } from '../src/theme';
import { SplashScreen } from '../src/screens/SplashScreen';
import { NetworkErrorScreen } from '../src/screens/NetworkErrorScreen';

function RootGate() {
  const { state, retry } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'loading') return;

    const inAppGroup = segments[0] === '(app)';
    const inAuth = segments[0] === 'auth';

    if (state.status === 'signedIn' && !inAppGroup) {
      router.replace('/(app)/dashboard');
    } else if (state.status === 'signedOut' && !inAuth) {
      router.replace('/auth');
    }
  }, [state.status, segments, router]);

  if (state.status === 'loading') return <SplashScreen />;
  if (state.status === 'networkError') {
    return <NetworkErrorScreen message={state.message} onRetry={retry} />;
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootGate />
          </AuthProvider>
        </QueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
