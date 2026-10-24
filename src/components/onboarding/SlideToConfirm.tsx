import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

export type SlideToConfirmProps = {
  onConfirm: () => void;
  isSaving?: boolean;
  disabled?: boolean;
  label?: string;
  confirmedLabel?: string;
  onSlideStart?: () => void;
  onSlideEnd?: () => void;
};

const THUMB_SIZE = 52;
const PADDING = 4;
const INITIAL_WIDTH = Math.max(280, Dimensions.get('window').width - 48);

export function SlideToConfirm({
  onConfirm,
  isSaving = false,
  disabled = false,
  label = 'Slide to Decode Skin',
  confirmedLabel = 'Calibrating Protocol...',
  onSlideStart,
  onSlideEnd,
}: SlideToConfirmProps) {
  const [trackWidth, setTrackWidth] = useState(INITIAL_WIDTH);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const panX = useRef(new Animated.Value(0)).current;
  const isConfirmedRef = useRef(false);
  const disabledRef = useRef(false);
  const isSavingRef = useRef(false);
  const maxDistanceRef = useRef(Math.max(0, INITIAL_WIDTH - THUMB_SIZE - PADDING * 2));
  const onSlideStartRef = useRef(onSlideStart);
  const onSlideEndRef = useRef(onSlideEnd);
  const onConfirmRef = useRef(onConfirm);

  // Sync refs on every render to eliminate closure traps
  isConfirmedRef.current = isConfirmed;
  disabledRef.current = disabled;
  isSavingRef.current = isSaving;
  onSlideStartRef.current = onSlideStart;
  onSlideEndRef.current = onSlideEnd;
  onConfirmRef.current = onConfirm;

  // Robust PanResponder capturing touch immediately
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current && !isSavingRef.current && !isConfirmedRef.current,
      onStartShouldSetPanResponderCapture: () => !disabledRef.current && !isSavingRef.current && !isConfirmedRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current && !isSavingRef.current && !isConfirmedRef.current,
      onMoveShouldSetPanResponderCapture: () => !disabledRef.current && !isSavingRef.current && !isConfirmedRef.current,
      onShouldBlockNativeResponder: () => true,

      onPanResponderGrant: () => {
        onSlideStartRef.current?.();
        panX.stopAnimation();
      },

      onPanResponderMove: (_, gestureState) => {
        if (disabledRef.current || isSavingRef.current || isConfirmedRef.current) return;
        const maxD = maxDistanceRef.current;
        if (maxD <= 0) return;

        // gestureState.dx is total displacement from initial touch point
        const clamped = Math.max(0, Math.min(gestureState.dx, maxD));
        panX.setValue(clamped);
      },

      onPanResponderRelease: (_, gestureState) => {
        onSlideEndRef.current?.();
        if (disabledRef.current || isSavingRef.current || isConfirmedRef.current) return;
        const maxD = maxDistanceRef.current;
        if (maxD <= 0) return;

        // Trigger threshold: 65% of track width
        if (gestureState.dx >= maxD * 0.65) {
          setIsConfirmed(true);
          isConfirmedRef.current = true;
          Animated.spring(panX, {
            toValue: maxD,
            useNativeDriver: false,
            bounciness: 0,
          }).start(() => {
            onConfirmRef.current?.();
          });
        } else {
          // Spring back smoothly to origin
          Animated.spring(panX, {
            toValue: 0,
            tension: 180,
            friction: 12,
            useNativeDriver: false,
          }).start();
        }
      },

      onPanResponderTerminate: () => {
        onSlideEndRef.current?.();
        if (!isConfirmedRef.current) {
          Animated.spring(panX, {
            toValue: 0,
            tension: 180,
            friction: 12,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - trackWidth) > 1) {
      setTrackWidth(w);
      maxDistanceRef.current = Math.max(0, w - THUMB_SIZE - PADDING * 2);
    }
  };

  const maxDist = Math.max(1, trackWidth - THUMB_SIZE - PADDING * 2);

  const textOpacity = panX.interpolate({
    inputRange: [0, maxDist * 0.4],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const activeWidth = panX.interpolate({
    inputRange: [0, maxDist],
    outputRange: [THUMB_SIZE + PADDING * 2, trackWidth],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.outerContainer} onLayout={onLayout}>
      <View style={[styles.track, (disabled || isSaving) && styles.trackDisabled]}>
        {/* Dynamic Green Fill revealing behind thumb */}
        <Animated.View style={[styles.activeTrackFill, { width: activeWidth }]} />

        {/* Center Label */}
        <Animated.View pointerEvents="none" style={[styles.labelWrap, { opacity: isConfirmed ? 0 : textOpacity }]}>
          <Text style={styles.labelText}>{label}</Text>
        </Animated.View>

        {/* Confirmed / Saving Label */}
        {(isConfirmed || isSaving) && (
          <View pointerEvents="none" style={styles.confirmedWrap}>
            <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.confirmedText}>{confirmedLabel}</Text>
          </View>
        )}

        {/* Draggable Thumb Button */}
        <Animated.View
          {...panResponder.panHandlers}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            styles.thumb,
            { transform: [{ translateX: panX }] },
          ]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#183626" />
          ) : isConfirmed ? (
            <Feather name="check" size={24} color="#183626" />
          ) : (
            <Feather name="arrow-right" size={22} color="#183626" />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
    paddingVertical: 8,
  },
  track: {
    width: '100%',
    height: THUMB_SIZE + PADDING * 2,
    borderRadius: (THUMB_SIZE + PADDING * 2) / 2,
    backgroundColor: '#1b3829',
    position: 'relative',
    justifyContent: 'center',
    paddingHorizontal: PADDING,
    overflow: 'hidden',
  },
  trackDisabled: {
    opacity: 0.7,
  },
  activeTrackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#2d6a4f',
    borderRadius: (THUMB_SIZE + PADDING * 2) / 2,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 24,
  },
  labelText: {
    color: '#ebf5ee',
    fontSize: 17.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  confirmedWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmedText: {
    color: '#ffffff',
    fontSize: 17.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
