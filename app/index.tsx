import { Redirect, type Href } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useOnboarding } from '../src/onboarding/OnboardingProvider';
import { OnboardingLoadError } from '../src/components/onboarding/OnboardingLoadError';

export default function IndexRoute() {
  const { session, isLoading } = useAuth();
  const { status, error, refreshStatus } = useOnboarding();
  if (isLoading) return <LoadingScreen />;
  if (!session) return <Redirect href="/login" />;
  if (status === 'loading' || status === 'signed_out') return <LoadingScreen />;
  if (status === 'error') {
    return <OnboardingLoadError message={error} onRetry={() => void refreshStatus()} />;
  }
  const destination: Href = status === 'complete' ? '/home' : '/(onboarding)/welcome' as Href;
  return <Redirect href={destination} />;
}
