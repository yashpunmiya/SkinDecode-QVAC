import React, { useEffect, useRef } from 'react';
import {
  Animated,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SlideToConfirm } from './SlideToConfirm';
import { OnboardingCloseButton } from './OnboardingCloseButton';

export type Choice<T> = { value: T; label: string; subtitle?: string; image?: any };

export type RevampedBlueprintProps = {
  isActive: boolean;
  answers: {
    ageRange: any;
    skinType: any;
    sensitivity: any;
    concerns: any[];
    goals: any[];
    preferences: any[];
  };
  ageOptions?: Choice<any>[];
  typeOptions?: Choice<any>[];
  sensitivityOptions?: Choice<any>[];
  concernOptions?: Choice<any>[];
  goalOptions?: Choice<any>[];
  preferenceOptions?: Choice<any>[];
  onSlideConfirm: () => void;
  onGoBack: () => void;
  onCancel?: () => void;
  title?: string;
  confirmLabel?: string;
  isSaving: boolean;
  onSlideStart?: () => void;
  onSlideEnd?: () => void;
};

type TagRowProps = {
  label: string;
  values: string[];
  tone?: 'sage' | 'rose' | 'sand';
};

function TagRow({ label, values, tone = 'sage' }: TagRowProps) {
  const tagTone = {
    sage: { container: styles.tagsage, text: styles.tagTextsage },
    rose: { container: styles.tagrose, text: styles.tagTextrose },
    sand: { container: styles.tagsand, text: styles.tagTextsand },
  }[tone];

  return (
    <View style={styles.tagRow}>
      <Text style={styles.tagLabel}>{label}</Text>
      <View style={styles.tagList}>
        {values.length > 0 ? (
          values.map((value, index) => (
            <View key={`${value}-${index}`} style={[styles.tag, tagTone.container]}>
              <Text style={[styles.tagText, tagTone.text]}>{value}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.tagEmpty}>None selected</Text>
        )}
      </View>
    </View>
  );
}

const promises = [
  {
    title: 'Barrier Safe',
    body: 'Skin-aware ingredient checks',
    image: require('../../assets/onboarding/blueprint/barrier-card.jpg'),
  },
  {
    title: 'Unbiased',
    body: 'No paid brand placement',
    image: require('../../assets/onboarding/blueprint/unbiased-card.jpg'),
  },
  {
    title: 'Adaptive',
    body: 'Care that changes with you',
    image: require('../../assets/onboarding/blueprint/adaptive-card.jpg'),
  },
];

export function RevampedBlueprint({
  isActive,
  answers,
  ageOptions,
  typeOptions,
  sensitivityOptions,
  concernOptions,
  goalOptions,
  preferenceOptions,
  onSlideConfirm,
  onGoBack,
  onCancel,
  title,
  confirmLabel,
  isSaving,
  onSlideStart,
  onSlideEnd,
}: RevampedBlueprintProps) {
  const { width: windowWidth } = useWindowDimensions();
  const headerAnim = useRef(new Animated.Value(0)).current;
  const summaryAnim = useRef(new Animated.Value(0)).current;
  const cardAnimations = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const sliderAnim = useRef(new Animated.Value(0)).current;
  const cardGap = 8;
  const cardWidth = Math.floor((Math.min(windowWidth - 32, 420) - cardGap * 2) / 3);

  useEffect(() => {
    let entrance: Animated.CompositeAnimation | undefined;
    if (isActive) {
      [headerAnim, summaryAnim, sliderAnim, ...cardAnimations].forEach((value) => value.setValue(0));
      entrance = Animated.sequence([
        Animated.parallel([
          Animated.timing(headerAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.timing(summaryAnim, { toValue: 1, duration: 480, delay: 100, useNativeDriver: true }),
        ]),
        Animated.stagger(90, cardAnimations.map((value) =>
          Animated.spring(value, { toValue: 1, speed: 18, bounciness: 4, useNativeDriver: true }),
        )),
        Animated.timing(sliderAnim, { toValue: 1, duration: 360, useNativeDriver: true }),
      ]);
      entrance.start();
    } else {
      headerAnim.setValue(0);
      summaryAnim.setValue(0);
      sliderAnim.setValue(0);
      cardAnimations.forEach((value) => value.setValue(0));
    }
    return () => entrance?.stop();
  }, [cardAnimations, headerAnim, isActive, sliderAnim, summaryAnim]);

  const getLabel = (value: any, options?: Choice<any>[]) =>
    options?.find((option) => option.value === value)?.label || String(value || '—');

  const selectedConcerns = (answers?.concerns || []).map((value) => getLabel(value, concernOptions));
  const selectedGoals = (answers?.goals || []).map((value) => getLabel(value, goalOptions));
  const selectedPreferences = (answers?.preferences || []).map((value) => getLabel(value, preferenceOptions));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.headerSection, entranceStyle(headerAnim)]}>
        <View style={styles.headerTitleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onGoBack}
            hitSlop={12}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={24} color="#15231b" />
          </Pressable>
          <Text style={styles.title}>{title || 'Your Skin Blueprint'}</Text>
          {onCancel ? (
            <OnboardingCloseButton accessibilityLabel="Cancel editing skin profile" onPress={onCancel} />
          ) : null}
        </View>
        <Text style={styles.subtitle}>A clearer, more personal way to understand your skin.</Text>
      </Animated.View>

      <Animated.View style={[styles.summaryCard, entranceStyle(summaryAnim)]}>
        <Text style={styles.sectionEyebrow}>Your profile</Text>
        <View style={styles.metricRow}>
          <Metric label="Age" value={getLabel(answers?.ageRange, ageOptions)} />
          <View style={styles.metricDivider} />
          <Metric label="Skin type" value={getLabel(answers?.skinType, typeOptions)} />
          <View style={styles.metricDivider} />
          <Metric label="Sensitivity" value={getLabel(answers?.sensitivity, sensitivityOptions)} />
        </View>
        <View style={styles.tagGroups}>
          <TagRow label="Concerns" values={selectedConcerns} tone="sage" />
          <TagRow label="Goals" values={selectedGoals} tone="rose" />
          {selectedPreferences.length > 0 ? (
            <TagRow label="Preferences" values={selectedPreferences} tone="sand" />
          ) : null}
        </View>
      </Animated.View>

      <View style={styles.promisesSection}>
        <Text style={styles.sectionTitle}>Made around you</Text>
        <View style={[styles.cardsRow, { gap: cardGap }]}>
          {promises.map((promise, index) => {
            const cardAnimation = cardAnimations[index];
            if (!cardAnimation) return null;

            const fromRotation = index === 1 ? '5deg' : index === 0 ? '-8deg' : '8deg';
            const toRotation = index === 1 ? '0deg' : index === 0 ? '-2deg' : '2deg';
            const rotation = cardAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [fromRotation, toRotation],
            });

            return (
              <Animated.View
                key={promise.title}
                style={[
                  styles.promiseCardMotion,
                  { width: cardWidth },
                  {
                    zIndex: index === 1 ? 2 : 1,
                    opacity: cardAnimation,
                    transform: [
                      { translateY: cardAnimation.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                      { scale: cardAnimation.interpolate({ inputRange: [0, 1], outputRange: [0.9, index === 1 ? 1.035 : 0.98] }) },
                      { rotate: rotation },
                    ],
                  },
                ]}
              >
                <ImageBackground
                  source={promise.image}
                  style={styles.promiseCard}
                  imageStyle={styles.promiseImage}
                  resizeMode="cover"
                  accessible
                  accessibilityLabel={`${promise.title}. ${promise.body}`}
                >
                  <View style={styles.promiseCopy}>
                    <Text style={styles.promiseTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {promise.title}
                    </Text>
                    <Text style={styles.promiseBody} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {promise.body}
                    </Text>
                  </View>
                </ImageBackground>
              </Animated.View>
            );
          })}
        </View>
      </View>

      <Animated.View style={[styles.actionSection, entranceStyle(sliderAnim)]}>
        <SlideToConfirm
          onConfirm={onSlideConfirm}
          isSaving={isSaving}
          label={confirmLabel || 'Slide to Decode Skin'}
          confirmedLabel="Preparing your profile..."
          onSlideStart={onSlideStart}
          onSlideEnd={onSlideEnd}
        />
        <Text style={styles.actionHint}>You can update your answers anytime.</Text>
      </Animated.View>
    </View>
  );
}

function entranceStyle(value: Animated.Value) {
  return {
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
      },
    ],
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingTop: 8,
    paddingBottom: 12,
    gap: 16,
  },
  headerSection: {
    paddingTop: 2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e8ebe5',
    shadowColor: '#102419',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  title: {
    color: '#15231b',
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: -0.5,
    flex: 1,
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: {
    color: '#58635c',
    fontSize: 16.5,
    lineHeight: 23,
    marginTop: 6,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ebe6',
    shadowColor: '#1b3325',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.045,
    shadowRadius: 14,
    elevation: 2,
  },
  sectionEyebrow: {
    color: '#88928a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#edf0eb',
  },
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    paddingHorizontal: 8,
  },
  metricLabel: {
    color: '#919b93',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  metricValue: {
    color: '#1c2d22',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 34,
    backgroundColor: '#e6ebe5',
  },
  tagGroups: {
    gap: 10,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  tagLabel: {
    width: 86,
    paddingTop: 4,
    color: '#7c887f',
    fontSize: 13.5,
    fontWeight: '600',
  },
  tagList: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagsage: {
    backgroundColor: '#f0f5ef',
    borderColor: '#e3ebe1',
  },
  tagrose: {
    backgroundColor: '#faf1ee',
    borderColor: '#f1e5e0',
  },
  tagsand: {
    backgroundColor: '#f8f4ec',
    borderColor: '#eee8dc',
  },
  tagText: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
  },
  tagTextsage: {
    color: '#36523d',
  },
  tagTextrose: {
    color: '#775047',
  },
  tagTextsand: {
    color: '#685a41',
  },
  tagEmpty: {
    color: '#a0a9a2',
    paddingTop: 4,
    fontSize: 13.5,
  },
  promisesSection: {
    gap: 10,
  },
  sectionTitle: {
    color: '#1b2a20',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promiseCardMotion: {
    height: 166,
    borderRadius: 18,
    shadowColor: '#1b3325',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  promiseCard: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(227, 232, 222, 0.9)',
  },
  promiseImage: {
    borderRadius: 18,
  },
  promiseCopy: {
    position: 'absolute',
    top: 12,
    left: 10,
    right: 9,
  },
  promiseTitle: {
    color: '#1b2b21',
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: -0.15,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    marginBottom: 5,
  },
  promiseBody: {
    color: '#46564b',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '500',
  },
  actionSection: {
    width: '100%',
    paddingTop: 2,
  },
  actionHint: {
    color: '#7c887f',
    fontSize: 13.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
});
