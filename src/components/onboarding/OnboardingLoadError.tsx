import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/tokens';

type Props = { message: string | null; onRetry: () => void };

export function OnboardingLoadError({ message, onRetry }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>We couldn’t load your profile</Text>
        <Text style={styles.body}>{message || 'Check your connection and try again.'}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  title: { color: colors.text, fontSize: 25, fontWeight: '600', letterSpacing: -0.5 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: 12 },
  button: { minHeight: 52, marginTop: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.surface, fontSize: 15, fontWeight: '600' },
});
