import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { invalidateSkinProfileCache } from '../products/catalog-service';
import type { OnboardingAnswers } from './types';

export type OnboardingStatus = 'signed_out' | 'loading' | 'required' | 'complete' | 'error';

type OnboardingContextValue = {
  status: OnboardingStatus;
  error: string | null;
  refreshStatus: () => Promise<void>;
  completeOnboarding: (answers: OnboardingAnswers) => Promise<void>;
};

type StoredStatus = {
  userId: string | null;
  status: Exclude<OnboardingStatus, 'signed_out'>;
  error: string | null;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

async function readOnboardingStatus(userId: string): Promise<Exclude<OnboardingStatus, 'signed_out' | 'loading' | 'error'>> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('onboarding_completed')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  console.info('[onboarding] completion status checked', {
    profileFound: Boolean(data),
    completed: data?.onboarding_completed ?? false,
  });
  return data?.onboarding_completed ? 'complete' : 'required';
}

export function OnboardingProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [storedStatus, setStoredStatus] = useState<StoredStatus>({
    userId: null,
    status: 'loading',
    error: null,
  });

  const refreshStatus = useCallback(async () => {
    if (!userId) {
      setStoredStatus({ userId: null, status: 'loading', error: null });
      return;
    }

    setStoredStatus({ userId, status: 'loading', error: null });
    try {
      const status = await readOnboardingStatus(userId);
      setStoredStatus({ userId, status, error: null });
    } catch (error) {
      console.warn('Could not load onboarding status:', error);
      setStoredStatus({ userId, status: 'error', error: 'Check your connection and try again.' });
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setStoredStatus({ userId: null, status: 'loading', error: null });
      return () => { active = false; };
    }

    setStoredStatus({ userId, status: 'loading', error: null });
    void (async () => {
      try {
        const status = await readOnboardingStatus(userId);
        if (!active) return;
        setStoredStatus({
          userId,
          status,
          error: null,
        });
      } catch (error) {
        if (active) {
          console.warn('Could not load onboarding status:', error);
          setStoredStatus({ userId, status: 'error', error: 'Check your connection and try again.' });
        }
      }
    })();

    return () => { active = false; };
  }, [userId]);

  const completeOnboarding = useCallback(async (answers: OnboardingAnswers) => {
    if (!userId) throw new Error('Your sign-in session has expired. Please sign in again.');
    if (!answers.ageRange || !answers.skinType || !answers.sensitivity) {
      throw new Error('Please complete each required skin profile question.');
    }
    if (answers.concerns.length < 1 || answers.concerns.length > 3) {
      throw new Error('Choose between one and three skin concerns.');
    }
    if (answers.goals.length < 1 || answers.goals.length > 3) {
      throw new Error('Choose between one and three skin goals.');
    }

    const { data, error } = await supabase.from('user_profiles').upsert({
      id: userId,
      age_range: answers.ageRange,
      skin_type: answers.skinType,
      sensitivity: answers.sensitivity,
      skin_concerns: answers.concerns,
      skin_goals: answers.goals,
      preferences: answers.preferences,
      onboarding_completed: true,
    }, { onConflict: 'id' }).select('onboarding_completed').single();

    if (error) throw error;
    if (!data.onboarding_completed) {
      throw new Error('The skin profile was saved but onboarding is not marked complete. Please try again.');
    }
    invalidateSkinProfileCache(userId);
    setStoredStatus({ userId, status: 'complete', error: null });
  }, [userId]);

  const status: OnboardingStatus = !userId
    ? 'signed_out'
    : storedStatus.userId === userId
      ? storedStatus.status
      : 'loading';

  const value = useMemo(
    () => ({
      status,
      error: storedStatus.userId === userId ? storedStatus.error : null,
      refreshStatus,
      completeOnboarding,
    }),
    [status, storedStatus.error, storedStatus.userId, userId, refreshStatus, completeOnboarding],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used within OnboardingProvider.');
  return context;
}
