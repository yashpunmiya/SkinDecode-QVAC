import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TabTriggerSlotProps } from 'expo-router/ui';

type WavyTabButtonProps = TabTriggerSlotProps & {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  activeIcon: ComponentProps<typeof Ionicons>['name'];
  reducedMotion: boolean;
};

export const WavyTabButton = forwardRef<View, WavyTabButtonProps>(function WavyTabButton(
  { label, icon, activeIcon, reducedMotion, isFocused = false, style, ...pressableProps },
  ref,
) {
  const focus = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    focus.stopAnimation();
    if (reducedMotion) {
      focus.setValue(isFocused ? 1 : 0);
      return;
    }
    const animation = Animated.spring(focus, {
      toValue: isFocused ? 1 : 0,
      speed: 22,
      bounciness: 3,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [focus, isFocused, reducedMotion]);

  const color = isFocused ? '#234e3d' : '#66716a';

  return (
    <Pressable
      {...pressableProps}
      ref={ref}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ ...pressableProps.accessibilityState, selected: isFocused }}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        styles.button,
        state.pressed && styles.pressed,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.icon, {
          transform: [{ translateY: focus.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }],
        }]}
      >
        <Ionicons name={isFocused ? activeIcon : icon} size={23} color={color} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, isFocused && styles.activeLabel]}>{label}</Text>
      <Animated.View pointerEvents="none" style={[styles.activeDot, { opacity: focus }]} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    flex: 1,
    height: 52,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3,
    gap: 2,
  },
  pressed: { opacity: 0.75 },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#66716a', fontSize: 9, lineHeight: 11, fontWeight: '500' },
  activeLabel: { color: '#234e3d', fontWeight: '600' },
  activeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#234e3d' },
});
