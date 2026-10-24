import React, { useEffect, useRef } from 'react';
import {
  Animated,
  type DimensionValue,
  Image,
  type ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type OptionTileProps = {
  label: string;
  subtitle?: string;
  image?: ImageSourcePropType;
  selected: boolean;
  disabled?: boolean;
  width?: DimensionValue;
  onPress: () => void;
};

export function OptionTile({
  label,
  subtitle,
  image,
  selected,
  disabled = false,
  width,
  onPress,
}: OptionTileProps) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(selected ? 1 : 0.72)).current;
  const artworkSize = typeof width === 'number' ? Math.min(96, Math.max(76, width * 0.48)) : 90;
  const labelFontSize = typeof width === 'number' && width < 145 ? 15.5 : 17;

  useEffect(() => {
    Animated.spring(checkScale, {
      toValue: selected ? 1 : 0.72,
      speed: 24,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [checkScale, selected]);

  const handlePressIn = () => {
    if (disabled) return;
    Animated.timing(pressScale, {
      toValue: 0.975,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      speed: 30,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        width ? { width } : null,
        { transform: [{ scale: pressScale }] },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.tile,
          selected && styles.tileSelected,
          disabled && styles.tileDisabled,
        ]}
      >
        <View style={[styles.leftColumn, { width: typeof width === 'number' ? Math.max(76, width - 38) : '74%' }]}>
          <Text
            numberOfLines={1}
            style={[styles.tileLabel, { fontSize: labelFontSize }, selected && styles.tileLabelSelected]}
          >
            {label}
          </Text>

          <Animated.View
            style={[
              styles.indicator,
              selected && styles.indicatorSelected,
              { transform: [{ scale: checkScale }] },
            ]}
          >
            {selected ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
          </Animated.View>
        </View>

        {image ? (
          <View pointerEvents="none" style={styles.imageContainer}>
            <Image
              source={image}
              resizeMode="contain"
              style={{ width: artworkSize, height: artworkSize, opacity: selected ? 1 : 0.94 }}
            />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  tile: {
    height: 108,
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e9e4db',
    backgroundColor: '#fffefa',
    shadowColor: '#29382f',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.055,
    shadowRadius: 9,
    elevation: 2,
    overflow: 'hidden',
  },
  tileSelected: {
    borderColor: '#42664d',
    backgroundColor: '#eff3e9',
    shadowColor: '#35563e',
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 3,
  },
  tileDisabled: { opacity: 0.48 },
  leftColumn: {
    position: 'absolute',
    left: 15,
    top: 14,
    bottom: 12,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 1,
    zIndex: 1,
  },
  tileLabel: {
    color: '#17251e',
    fontSize: 17,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: -0.2,
  },
  tileLabelSelected: { color: '#193323', fontWeight: '600' },
  indicator: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#c9c4b9',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorSelected: { borderColor: '#32553e', backgroundColor: '#32553e' },
  imageContainer: {
    position: 'absolute',
    right: -7,
    bottom: -15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
