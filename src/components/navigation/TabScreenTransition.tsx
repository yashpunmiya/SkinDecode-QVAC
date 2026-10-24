import React, { useCallback, useRef, type PropsWithChildren } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function TabScreenTransition({ children }: PropsWithChildren) {
  const entrance = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      entrance.setValue(0);
      const animation = Animated.timing(entrance, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
      return () => animation.stop();
    }, [entrance]),
  );

  return (
    <Animated.View
      style={[
        styles.screen,
        {
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
