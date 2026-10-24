import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth/AuthProvider';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { OptionCard } from '../../src/components/onboarding/OptionCard';
import { OptionTile } from '../../src/components/onboarding/OptionTile';
import { colors } from '../../src/theme/tokens';
import { concernImages, goalImages, sensitivityImages, typeImages } from '../../src/assets/onboarding/assets';
import { AgeWheelPicker } from '../../src/components/onboarding/AgeWheelPicker';
import { OnboardingCloseButton } from '../../src/components/onboarding/OnboardingCloseButton';
import { RevampedBlueprint } from '../../src/components/onboarding/RevampedBlueprint';
import { useOnboarding } from '../../src/onboarding/OnboardingProvider';
import { getSkinProfile } from '../../src/products/catalog-service';
import { OnboardingLoadError } from '../../src/components/onboarding/OnboardingLoadError';
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from '../../src/onboarding/draft-storage';
import {
  emptyOnboardingAnswers,
  type AgeRange,
  type OnboardingAnswers,
  type SkinConcern,
  type SkinGoal,
  type SkinPreference,
  type SkinType,
  type SensitivityLevel,
} from '../../src/onboarding/types';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type Choice<T extends string> = {
  value: T;
  label: string;
  subtitle?: string;
  image?: ImageSourcePropType;
};

const stepMeta: Record<Step, { title: string; hint?: string }> = {
  0: {
    title: 'What’s your age?',
  },
  1: {
    title: 'How does your skin feel?',
    hint: 'Select the profile that best describes your bare skin after cleansing.',
  },
  2: {
    title: 'How reactive is your skin?',
    hint: 'We’ll flag potential irritants, strong fragrance, and drying alcohols.',
  },
  3: {
    title: 'What are your main concerns?',
    hint: 'Choose up to 3 focus areas to prioritize.',
  },
  4: {
    title: 'What are your skin goals?',
    hint: 'Choose up to 3 outcomes you want to achieve.',
  },
  5: {
    title: 'Any formula preferences?',
    hint: 'Optional. We filter formulas to match your lifestyle values.',
  },
  6: {
    title: 'Your Skin Blueprint',
    hint: 'Your profile has been calibrated. You can update this anytime.',
  },
};

const ageOptions: Choice<AgeRange>[] = [
  { value: 'under_18', label: 'Under 18', subtitle: 'Youthful barrier balance & gentle care' },
  { value: '18_24', label: '18–24', subtitle: 'Early defense & antioxidant daily shield' },
  { value: '25_34', label: '25–34', subtitle: 'Cellular renewal & first-line protection' },
  { value: '35_44', label: '35–44', subtitle: 'Targeted collagen & elasticity support' },
  { value: '45_plus', label: '45+', subtitle: 'Deep hydration & rich lipid replenishment' },
];

const typeOptions: Choice<SkinType>[] = [
  { value: 'oily', label: 'Oily', image: typeImages.oily },
  { value: 'dry', label: 'Dry', image: typeImages.dry },
  { value: 'combination', label: 'Combination', image: typeImages.combination },
  { value: 'normal', label: 'Normal', image: typeImages.normal },
  { value: 'not_sure', label: 'Not sure', image: typeImages.not_sure },
];

const sensitivityOptions: Choice<SensitivityLevel>[] = [
  { value: 'low', label: 'Low', image: sensitivityImages.low },
  { value: 'moderate', label: 'Moderate', image: sensitivityImages.moderate },
  { value: 'high', label: 'High', image: sensitivityImages.high },
  { value: 'not_sure', label: 'Not sure', image: typeImages.not_sure },
];

const concernOptions: Choice<SkinConcern>[] = [
  { value: 'acne', label: 'Acne', image: concernImages.acne },
  { value: 'dark_spots', label: 'Dark Spots', image: concernImages.dark_spots },
  { value: 'redness', label: 'Redness', image: concernImages.redness },
  { value: 'dryness', label: 'Dryness', image: concernImages.dryness },
  { value: 'oiliness', label: 'Oiliness', image: concernImages.oiliness },
  { value: 'texture', label: 'Texture', image: concernImages.texture },
  { value: 'pores', label: 'Pores', image: concernImages.pores },
  { value: 'fine_lines', label: 'Fine Lines', image: concernImages.fine_lines },
  { value: 'dullness', label: 'Dullness', image: concernImages.dullness },
];

const goalOptions: Choice<SkinGoal>[] = [
  { value: 'clear_acne', label: 'Clear Acne', image: goalImages.clear_acne },
  { value: 'even_tone', label: 'Even Tone', image: goalImages.even_tone },
  { value: 'hydrate', label: 'Hydrate', image: goalImages.hydrate },
  { value: 'repair_barrier', label: 'Repair Barrier', image: goalImages.repair_barrier },
  { value: 'reduce_redness', label: 'Calm Redness', image: goalImages.reduce_redness },
  { value: 'smooth_texture', label: 'Smooth Texture', image: goalImages.smooth_texture },
  { value: 'anti_aging', label: 'Healthy Aging', image: goalImages.anti_aging },
  { value: 'maintain', label: 'Maintain Skin', image: goalImages.maintain },
];

const preferenceOptions: Choice<SkinPreference>[] = [
  { value: 'fragrance_free', label: 'Fragrance-free', subtitle: 'Zero artificial perfume or essential oils' },
  { value: 'vegan', label: '100% Vegan', subtitle: 'No animal-derived ingredients' },
  { value: 'cruelty_free', label: 'Cruelty-free', subtitle: 'Certified never tested on animals' },
  { value: 'avoid_alcohol', label: 'Alcohol-free', subtitle: 'No drying denatured alcohol' },
  { value: 'none', label: 'No preferences', subtitle: 'Open to all safe, dermatologist-rated formulas' },
];

function isStep(value: number): value is Step {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function ageRangeToApproxAge(range: AgeRange | null): number {
  switch (range) {
    case 'under_18': return 16;
    case '18_24': return 21;
    case '25_34': return 27;
    case '35_44': return 38;
    case '45_plus': return 50;
    default: return 27;
  }
}

export default function OnboardingScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isEditing = mode === 'edit';
  const { session } = useAuth();
  const { completeOnboarding, status: onboardingStatus } = useOnboarding();
  const userId = session?.user.id;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...emptyOnboardingAnswers,
    ageRange: '25_34',
  }));
  const [selectedAge, setSelectedAge] = useState<number>(27);
  const [step, setStep] = useState<Step>(0);
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step6ScrollEnabled, setStep6ScrollEnabled] = useState(true);
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  // Native Horizontal ScrollView Ref for 120fps sliding
  const scrollRef = useRef<ScrollView>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Button press feedback
  const arrowScale = useRef(new Animated.Value(1)).current;
  const backScale = useRef(new Animated.Value(1)).current;
  const actionScale = useRef(new Animated.Value(1)).current;

  // Responsive Grid Calculations: Exact 2-column layout as in mockup screenshot
  const horizontalPadding = 22;
  const gridGap = 12;
  const cardWidth = Math.floor(
    pageWidth < 360
      ? pageWidth - horizontalPadding * 2
      : (pageWidth - horizontalPadding * 2 - gridGap) / 2,
  );

  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
  }, []);

  // Restore draft
  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    setIsHydrated(false);

    const hydrate = isEditing
      ? getSkinProfile(userId).then((profile) => {
        if (!profile?.onboarding_completed) throw new Error('Your saved skin profile could not be found.');
        if (!active) return;
        const savedAnswers: OnboardingAnswers = {
          ageRange: profile.age_range,
          skinType: profile.skin_type,
          sensitivity: profile.sensitivity,
          concerns: profile.skin_concerns || [],
          goals: profile.skin_goals || [],
          preferences: profile.preferences || [],
        };
        setAnswers(savedAnswers);
        setSelectedAge(ageRangeToApproxAge(savedAnswers.ageRange));
        setStep(0);
        setProfileLoadError(null);
        setTimeout(() => scrollRef.current?.scrollTo({ x: 0, animated: false }), 50);
      })
      : loadOnboardingDraft(userId).then((draft) => {
        if (!active) return;
        if (draft) {
          setAnswers(draft.answers);
          if (draft.answers.ageRange) {
            setSelectedAge(ageRangeToApproxAge(draft.answers.ageRange));
          }
          const initialStep = isStep(draft.step) ? draft.step : 0;
          setStep(initialStep);
          setTimeout(() => {
            scrollRef.current?.scrollTo({ x: initialStep * pageWidth, animated: false });
          }, 50);
        }
      });

    hydrate
      .catch((error) => {
        if (active && isEditing) {
          console.warn('Could not load skin profile for editing:', error);
          setProfileLoadError('Check your connection and try again.');
        }
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });

    return () => { active = false; };
  }, [userId, pageWidth, isEditing, profileLoadAttempt]);

  // Persist draft
  useEffect(() => {
    if (!userId || !isHydrated || isSaving || isEditing) return;
    const timer = setTimeout(() => {
      void saveOnboardingDraft(userId, { version: 1, step, answers }).catch(() => {
        // Silently catch local draft errors
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [userId, isHydrated, isSaving, isEditing, step, answers]);

  // Native slide navigation
  const goToStep = useCallback(
    (next: Step, animated = true) => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      setErrorMessage(null);
      setStep(next);
      scrollRef.current?.scrollTo({
        x: next * pageWidth,
        animated,
      });
    },
    [pageWidth]
  );

  const animatePress = (scale: Animated.Value, toValue: number) => {
    Animated.timing(scale, {
      toValue,
      duration: 70,
      useNativeDriver: true,
    }).start();
  };

  // Validation
  const valid = useMemo(() => {
    if (step === 5 || step === 6) return true;
    if (step === 0) return Boolean(answers.ageRange);
    if (step === 1) return Boolean(answers.skinType);
    if (step === 2) return Boolean(answers.sensitivity);
    if (step === 3) return answers.concerns.length >= 1 && answers.concerns.length <= 3;
    if (step === 4) return answers.goals.length >= 1 && answers.goals.length <= 3;
    return true;
  }, [step, answers]);

  // Single-select auto advance
  const handleSingleSelect = <K extends 'ageRange' | 'skinType' | 'sensitivity'>(
    key: K,
    value: NonNullable<OnboardingAnswers[K]>,
    nextStep: Step
  ) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));

    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = setTimeout(() => {
      goToStep(nextStep);
    }, 220);
  };

  // Multi-select toggle
  const handleToggle = <T extends string>(
    key: 'concerns' | 'goals' | 'preferences',
    value: T,
    limit?: number
  ) => {
    setAnswers((current) => {
      const currentValues = current[key] as T[];

      // Tapping "No preferences" auto-advances directly to summary
      if (key === 'preferences' && value === 'none') {
        if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = setTimeout(() => {
          goToStep(6);
        }, 220);
        return { ...current, preferences: ['none'] };
      }

      let updatedList: T[];
      if (currentValues.includes(value)) {
        updatedList = currentValues.filter((item) => item !== value);
      } else {
        if (key === 'preferences' && currentValues.includes('none' as T)) {
          updatedList = [value];
        } else {
          if (limit && currentValues.length >= limit) return current;
          updatedList = [...currentValues, value];
        }
      }

      // Auto-advance if max limit is reached for concerns or goals
      if (limit && updatedList.length === limit && !currentValues.includes(value)) {
        if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = setTimeout(() => {
          if (key === 'concerns') goToStep(4);
          if (key === 'goals') goToStep(5);
        }, 260);
      }

      return { ...current, [key]: updatedList };
    });
  };

  const handlePrimary = async () => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    setErrorMessage(null);

    if (step < 6) {
      goToStep((step + 1) as Step);
      return;
    }

    setIsSaving(true);
    try {
      await completeOnboarding(answers);
      try {
        await clearOnboardingDraft(userId!);
      } catch {
        /* Ignored harmless */
      }
      router.replace('/home');
    } catch (error) {
      console.warn('Could not save onboarding profile:', error);
      setErrorMessage('Could not save your profile. Check connection and retry.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!userId || !isHydrated) return <LoadingScreen />;
  if (isEditing && profileLoadError) {
    return <OnboardingLoadError message={profileLoadError} onRetry={() => setProfileLoadAttempt((attempt) => attempt + 1)} />;
  }
  if (!isEditing && onboardingStatus === 'complete') return <Redirect href="/home" />;

  return (
    <SafeAreaView style={[styles.safeArea, step === 6 && styles.summarySafeArea]} edges={['top']}>
      <View
        style={styles.mainContainer}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - pageWidth) > 1) {
            setPageWidth(w);
            scrollRef.current?.scrollTo({ x: step * w, animated: false });
          }
        }}
      >
        {/* Pinned Top Bar: Segmented Progress */}
        {step < 6 ? (
          <View style={styles.topBar}>
            <View style={styles.progressRow}>
              <View style={styles.segmentedProgress}>
                {[0, 1, 2, 3, 4, 5].map((seg) => {
                  const isFilled = step >= seg;
                  return (
                    <View key={seg} style={styles.segmentTrack}>
                      <View style={[styles.segmentFill, isFilled && styles.segmentFillDone]} />
                    </View>
                  );
                })}
              </View>
              {isEditing ? (
                <OnboardingCloseButton accessibilityLabel="Cancel editing skin profile" onPress={() => router.back()} />
              ) : null}
            </View>
          </View>
        ) : null}

        {/* 120fps Horizontal Sliding Pager */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ width: pageWidth * 7 }}
          style={styles.pagerContainer}
        >
          {/* STEP 0: Age Range (Direct Landing Diagnostic) */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <View style={styles.stepNoScrollContent}>
              <View style={styles.stepHeaderWrap}>
                <Text style={styles.mainTitle}>{stepMeta[0].title}</Text>
                {stepMeta[0].hint ? <Text style={styles.mainHint}>{stepMeta[0].hint}</Text> : null}
              </View>

              <AgeWheelPicker
                initialAge={selectedAge}
                onAgeChange={(newAge, range) => {
                  setSelectedAge(newAge);
                  setAnswers((prev) => ({ ...prev, ageRange: range }));
                }}
              />
            </View>
          </View>

          {/* STEP 1: Skin Type (Exact 2-Column Grid with 3D Assets) */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mainTitle}>{stepMeta[1].title}</Text>
              <Text style={styles.mainHint}>{stepMeta[1].hint}</Text>

              <View style={[styles.gridWrap, { gap: gridGap }]}>
                {typeOptions.map((opt) => (
                  <OptionTile
                    key={opt.value}
                    width={cardWidth}
                    label={opt.label}
                    image={opt.image}
                    selected={answers.skinType === opt.value}
                    onPress={() => handleSingleSelect('skinType', opt.value, 2)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* STEP 2: Sensitivity (2-Column Grid with 3D Assets) */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mainTitle}>{stepMeta[2].title}</Text>
              <Text style={styles.mainHint}>{stepMeta[2].hint}</Text>

              <View style={[styles.gridWrap, { gap: gridGap }]}>
                {sensitivityOptions.map((opt) => (
                  <OptionTile
                    key={opt.value}
                    width={cardWidth}
                    label={opt.label}
                    image={opt.image}
                    selected={answers.sensitivity === opt.value}
                    onPress={() => handleSingleSelect('sensitivity', opt.value, 3)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* STEP 3: Skin Concerns (Exact 2-Column Mockup Layout with 3D Assets) */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mainTitle}>{stepMeta[3].title}</Text>
              <Text style={styles.mainHint}>{stepMeta[3].hint}</Text>

              <View style={[styles.gridWrap, { gap: gridGap }]}>
                {concernOptions.map((opt) => (
                  <OptionTile
                    key={opt.value}
                    width={cardWidth}
                    label={opt.label}
                    image={opt.image}
                    selected={answers.concerns.includes(opt.value)}
                    disabled={answers.concerns.length >= 3 && !answers.concerns.includes(opt.value)}
                    onPress={() => handleToggle('concerns', opt.value, 3)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* STEP 4: Skin Goals (Exact 2-Column Layout with 3D Assets) */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mainTitle}>{stepMeta[4].title}</Text>
              <Text style={styles.mainHint}>{stepMeta[4].hint}</Text>

              <View style={[styles.gridWrap, { gap: gridGap }]}>
                {goalOptions.map((opt) => (
                  <OptionTile
                    key={opt.value}
                    width={cardWidth}
                    label={opt.label}
                    image={opt.image}
                    selected={answers.goals.includes(opt.value)}
                    disabled={answers.goals.length >= 3 && !answers.goals.includes(opt.value)}
                    onPress={() => handleToggle('goals', opt.value, 3)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* STEP 5: Formula Preferences */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mainTitle}>{stepMeta[5].title}</Text>
              <Text style={styles.mainHint}>{stepMeta[5].hint}</Text>

              <View style={styles.cardsStack}>
                {preferenceOptions.map((opt) => (
                  <OptionCard
                    key={opt.value}
                    label={opt.label}
                    subtitle={opt.subtitle}
                    multiple
                    selected={answers.preferences.includes(opt.value)}
                    onPress={() => handleToggle('preferences', opt.value)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* STEP 6: Revamped Animated Diagnostic Blueprint */}
          <View style={[styles.pageWrapper, { width: pageWidth }]}>
            <ScrollView
              contentContainerStyle={styles.stepSummaryScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={step6ScrollEnabled}
            >
              <RevampedBlueprint
                isActive={step === 6}
                answers={answers}
                ageOptions={ageOptions}
                typeOptions={typeOptions}
                sensitivityOptions={sensitivityOptions}
                concernOptions={concernOptions}
                goalOptions={goalOptions}
                preferenceOptions={preferenceOptions}
                onSlideConfirm={() => void handlePrimary()}
                onGoBack={() => goToStep(5)}
                onCancel={isEditing ? () => router.back() : undefined}
                title={isEditing ? 'Review your skin profile' : undefined}
                confirmLabel={isEditing ? 'Save changes' : undefined}
                isSaving={isSaving}
                onSlideStart={() => setStep6ScrollEnabled(false)}
                onSlideEnd={() => setStep6ScrollEnabled(true)}
              />
            </ScrollView>
          </View>
        </ScrollView>

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorNotice}>
            {errorMessage}
          </Text>
        ) : null}

        {/* Floating Bottom Navigation: Shown on questionnaire steps 0-5 */}
        {step < 6 ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.floatingDock,
              { paddingBottom: Math.max(insets.bottom, 22) },
            ]}
          >
            {/* Back Button */}
            {step > 0 ? (
              <Animated.View style={{ transform: [{ scale: backScale }] }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  onPressIn={() => animatePress(backScale, 0.92)}
                  onPressOut={() => animatePress(backScale, 1)}
                  onPress={() => goToStep((step - 1) as Step)}
                  style={styles.circleNavBtn}
                >
                  <Feather name="arrow-left" size={24} color="#15241b" />
                </Pressable>
              </Animated.View>
            ) : (
              <View style={styles.navPlaceholder} />
            )}

            {/* Action button: Circular Icon Button on steps 0-5 */}
            <Animated.View style={{ transform: [{ scale: arrowScale }] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next question"
                accessibilityState={{ disabled: !valid || isSaving }}
                disabled={!valid || isSaving}
                onPressIn={() => animatePress(arrowScale, 0.92)}
                onPressOut={() => animatePress(arrowScale, 1)}
                onPress={() => void handlePrimary()}
                style={[
                  styles.circleNextBtn,
                  valid ? styles.circleNextActive : styles.circleNextDisabled,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Feather
                    name="arrow-right"
                    size={24}
                    color={valid ? '#ffffff' : '#9eb0a4'}
                  />
                )}
              </Pressable>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#faf9f5',
  },
  summarySafeArea: {
    backgroundColor: '#ffffff',
  },
  mainContainer: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 8,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  segmentedProgress: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 4.5,
    marginBottom: 6,
  },
  segmentTrack: {
    flex: 1,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: '#e7e6df',
    overflow: 'hidden',
  },
  segmentFill: {
    height: '100%',
    width: '0%',
    borderRadius: 2.5,
    backgroundColor: '#456450',
  },
  segmentFillDone: {
    width: '100%',
    backgroundColor: '#456450',
  },
  pagerContainer: {
    flex: 1,
  },
  pageWrapper: {
    flex: 1,
  },
  stepScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 110,
  },
  stepNoScrollContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 10,
    paddingBottom: 0,
    alignItems: 'center',
    width: '100%',
  },
  stepHeaderWrap: {
    width: '100%',
    paddingHorizontal: 22,
    alignItems: 'center',
    marginBottom: 4,
  },
  mainTitle: {
    color: '#15231b',
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: -0.5,
    textAlign: 'center',
    alignSelf: 'center',
  },
  mainHint: {
    color: '#58635c',
    fontSize: 15.5,
    lineHeight: 22,
    marginTop: 7,
    marginBottom: 18,
    textAlign: 'center',
    alignSelf: 'center',
  },
  welcomeHero: {
    alignItems: 'center',
    marginTop: 10,
  },
  brandIconBox: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#eaf0eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroFeatureList: {
    width: '100%',
    gap: 11,
  },
  heroFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1.2,
    borderColor: '#eae9e3',
    gap: 13,
    shadowColor: '#14261d',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 2,
  },
  heroFeatureTextWrap: {
    flex: 1,
  },
  heroFeatureTitle: {
    color: '#15231b',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  heroFeatureDesc: {
    color: '#58635c',
    fontSize: 12,
    lineHeight: 16,
  },
  cardsStack: {
    gap: 10,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stepSummaryScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
    flexGrow: 1,
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
  },
  floatingDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  circleNavBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(21, 35, 27, 0.08)',
    shadowColor: '#102217',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  circleNextBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(21, 35, 27, 0.08)',
    shadowColor: '#102217',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  circleNextActive: {
    backgroundColor: '#21432f',
  },
  circleNextDisabled: {
    backgroundColor: '#e6eae7',
    borderColor: '#d7deda',
    shadowOpacity: 0,
    elevation: 0,
  },
  navPlaceholder: {
    width: 60,
    height: 60,
  },
  disabled: {
    opacity: 0.6,
  },
  errorNotice: {
    color: colors.danger,
    fontSize: 12.5,
    paddingBottom: 4,
    textAlign: 'center',
  },
});
