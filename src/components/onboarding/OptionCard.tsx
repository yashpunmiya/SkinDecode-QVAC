import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type OptionCardProps = {
  label: string;
  subtitle?: string;
  selected: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function OptionCard({
  label,
  subtitle,
  selected,
  multiple = false,
  disabled = false,
  onPress,
}: OptionCardProps) {
  const pressScale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (disabled) return;
    Animated.timing(pressScale, {
      toValue: 0.98,
      duration: 70,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(pressScale, {
      toValue: 1,
      duration: 90,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      <Pressable
        accessibilityRole={multiple ? 'checkbox' : 'radio'}
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.card,
          selected && styles.cardSelected,
          disabled && styles.cardDisabled,
        ]}
      >
        <View style={styles.textContainer}>
          <Text style={[styles.label, selected && styles.labelSelected]}>
            {label}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[styles.subtitle, selected && styles.subtitleSelected]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.indicator,
            selected && styles.indicatorSelected,
          ]}
        >
          {selected ? (
            <Ionicons name="checkmark" size={13} color="#ffffff" />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#eae9e3',
    backgroundColor: '#faf9f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#14261d',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 2,
  },
  cardSelected: {
    borderColor: '#234b35',
    backgroundColor: '#e5efe7',
    shadowColor: '#234b35',
    shadowOpacity: 0.08,
    shadowRadius: 7,
    elevation: 3,
  },
  cardDisabled: {
    opacity: 0.4,
  },
  textContainer: {
    flex: 1,
    paddingRight: 12,
  },
  label: {
    color: '#15241c',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: -0.2,
  },
  labelSelected: {
    color: '#11291d',
    fontWeight: '700',
  },
  subtitle: {
    color: '#65756c',
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 2,
  },
  subtitleSelected: {
    color: '#345543',
  },
  indicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#c6cbbf',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  indicatorSelected: {
    borderColor: '#234b35',
    backgroundColor: '#234b35',
  },
});
