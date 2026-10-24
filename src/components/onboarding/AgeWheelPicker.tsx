import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { type AgeRange } from '../../onboarding/types';

export type AgeWheelPickerProps = {
  initialAge?: number;
  minAge?: number;
  maxAge?: number;
  onAgeChange: (age: number, range: AgeRange) => void;
};

const ROW_HEIGHT = 96;
const WHEEL_HEIGHT = ROW_HEIGHT * 5;

export function ageToAgeRange(age: number): AgeRange {
  if (age < 18) return 'under_18';
  if (age <= 24) return '18_24';
  if (age <= 34) return '25_34';
  if (age <= 44) return '35_44';
  return '45_plus';
}

export function AgeWheelPicker({
  initialAge = 27,
  minAge = 14,
  maxAge = 80,
  onAgeChange,
}: AgeWheelPickerProps) {
  const ages = useMemo(
    () => Array.from({ length: maxAge - minAge + 1 }, (_, index) => minAge + index),
    [maxAge, minAge],
  );
  const clampAge = useCallback((value: number) => Math.max(minAge, Math.min(maxAge, Math.round(value))), [maxAge, minAge]);
  const [age, setAge] = useState(() => clampAge(initialAge));
  const ageRef = useRef(age);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value((clampAge(initialAge) - minAge) * ROW_HEIGHT)).current;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMomentumActive = useRef(false);

  const commitOffset = useCallback((offset: number) => {
    const nextAge = clampAge(minAge + Math.round(offset / ROW_HEIGHT));
    const snappedOffset = (nextAge - minAge) * ROW_HEIGHT;
    scrollRef.current?.scrollTo({ y: snappedOffset, animated: Math.abs(snappedOffset - offset) > 1 });
    if (nextAge !== ageRef.current) {
      ageRef.current = nextAge;
      setAge(nextAge);
    }
    onAgeChange(nextAge, ageToAgeRange(nextAge));
    isMomentumActive.current = false;
  }, [clampAge, minAge, onAgeChange]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextAge = clampAge(minAge + Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT));
    if (nextAge !== ageRef.current) {
      ageRef.current = nextAge;
      setAge(nextAge);
    }
  }, [clampAge, minAge]);

  const scrollHandler = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: true, listener: handleScroll },
  ), [handleScroll, scrollY]);

  useEffect(() => {
    const nextAge = clampAge(initialAge);
    if (nextAge === ageRef.current) return;
    ageRef.current = nextAge;
    setAge(nextAge);
    const offset = (nextAge - minAge) * ROW_HEIGHT;
    scrollY.setValue(offset);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: offset, animated: true }));
  }, [clampAge, initialAge, minAge, scrollY]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const offset = event.nativeEvent.contentOffset.y;
    settleTimer.current = setTimeout(() => {
      if (!isMomentumActive.current) commitOffset(offset);
    }, 120);
  };

  const handleMomentumBegin = () => {
    isMomentumActive.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    commitOffset(event.nativeEvent.contentOffset.y);
  };

  return (
    <View style={styles.container}>
      <View style={styles.wheelFrame}>
        <Animated.ScrollView
          ref={scrollRef}
          style={styles.wheel}
          contentContainerStyle={styles.wheelContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          snapToInterval={ROW_HEIGHT}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={scrollHandler}
          onScrollBeginDrag={() => { isMomentumActive.current = false; }}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollBegin={handleMomentumBegin}
          onMomentumScrollEnd={handleMomentumEnd}
          contentOffset={{ x: 0, y: (clampAge(initialAge) - minAge) * ROW_HEIGHT }}
          accessibilityLabel="Age selector"
        >
          {ages.map((item, index) => {
            const distance = scrollY.interpolate({
              inputRange: [
                (index - 2) * ROW_HEIGHT,
                (index - 1) * ROW_HEIGHT,
                index * ROW_HEIGHT,
                (index + 1) * ROW_HEIGHT,
                (index + 2) * ROW_HEIGHT,
              ],
              outputRange: [0.22, 0.5, 1, 0.5, 0.22],
              extrapolate: 'clamp',
            });
            const scale = scrollY.interpolate({
              inputRange: [
                (index - 2) * ROW_HEIGHT,
                (index - 1) * ROW_HEIGHT,
                index * ROW_HEIGHT,
                (index + 1) * ROW_HEIGHT,
                (index + 2) * ROW_HEIGHT,
              ],
              outputRange: [0.68, 0.82, 1, 0.82, 0.68],
              extrapolate: 'clamp',
            });
            const isSelected = age === item;

            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`${item} years`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  const offset = index * ROW_HEIGHT;
                  scrollRef.current?.scrollTo({ y: offset, animated: true });
                  if (settleTimer.current) clearTimeout(settleTimer.current);
                  settleTimer.current = setTimeout(() => commitOffset(offset), 320);
                }}
                style={styles.ageRow}
              >
                <Animated.View style={[styles.ageRowContent, { opacity: distance, transform: [{ scale }] }]}>
                  <Text style={[styles.ageNumber, isSelected && styles.ageNumberSelected]}>{item}</Text>
                </Animated.View>
              </Pressable>
            );
          })}
        </Animated.ScrollView>
        <Text pointerEvents="none" style={styles.ageUnit}>years</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  wheelFrame: { position: 'relative', width: '100%', height: WHEEL_HEIGHT, overflow: 'hidden' },
  wheel: { width: '100%', height: WHEEL_HEIGHT, flexGrow: 0 },
  wheelContent: { paddingVertical: (WHEEL_HEIGHT - ROW_HEIGHT) / 2 },
  ageRow: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  ageRowContent: { width: '100%', alignItems: 'center' },
  ageNumber: { color: '#aeb4af', fontSize: 64, lineHeight: 76, fontWeight: '400', fontVariant: ['tabular-nums'] },
  ageNumberSelected: { color: '#111512', fontSize: 96, lineHeight: 108, fontWeight: '700', letterSpacing: -2.4 },
  ageUnit: { position: 'absolute', top: (WHEEL_HEIGHT - 20) / 2 + 10, left: '50%', marginLeft: 62, color: '#536158', fontSize: 14, lineHeight: 20, fontWeight: '500' },
});
