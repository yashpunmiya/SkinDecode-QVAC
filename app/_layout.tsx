import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { OnboardingProvider, useOnboarding } from '../src/onboarding/OnboardingProvider';
import { RemindersProvider } from '../src/reminders/RemindersProvider';

function RootNavigator() {
  const { session, isLoading } = useAuth();
  const { status } = useOnboarding();
  if (isLoading || (session && (status === 'loading' || status === 'signed_out'))) {
    return <LoadingScreen />;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f8f8f5' } }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session) && status === 'complete'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <AuthenticatedApp />
      </OnboardingProvider>
    </AuthProvider>
  );
}

function AuthenticatedApp() {
  const { session, isLoading } = useAuth();
  return (
    <RemindersProvider userId={isLoading ? undefined : session?.user.id ?? null}>
      <RootNavigator />
    </RemindersProvider>
  );
}
