import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

type OnboardingCloseButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
};

export function OnboardingCloseButton({
  onPress,
  accessibilityLabel = 'Close',
}: OnboardingCloseButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Feather name="x" size={17} color="#43564a" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5eae3',
    shadowColor: '#203a2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
});
