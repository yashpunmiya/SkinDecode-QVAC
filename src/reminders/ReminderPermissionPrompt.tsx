import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaterReminderStyle } from './models';

type Props = {
  visible: boolean;
  canAskAgain: boolean;
  isRequesting: boolean;
  onEnable: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
  waterReminderStyle: WaterReminderStyle;
  onWaterReminderStyleChange: (style: WaterReminderStyle) => void;
};

export function ReminderPermissionPrompt({ visible, canAskAgain, isRequesting, onEnable, onOpenSettings, onDismiss, waterReminderStyle, onWaterReminderStyleChange }: Props) {
  const requestPermission = canAskAgain || !visible;
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.icon}><Feather name="bell" size={21} color="#315d48" /></View>
          <Text style={styles.eyebrow}>A GENTLE NUDGE</Text>
          <Text style={styles.title}>Stay in your skin-care rhythm</Text>
          <Text style={styles.body}>Allow notifications for your routines, daily skin check, and water reminders. You can change any time.</Text>
          <View style={styles.schedule}>
            <View style={styles.scheduleRow}><Text style={styles.scheduleLabel}>Morning routine</Text><Text style={styles.scheduleTime}>9:00 AM</Text></View>
            <View style={styles.scheduleRow}><Text style={styles.scheduleLabel}>Evening routine</Text><Text style={styles.scheduleTime}>7:00 PM</Text></View>
            <View style={styles.scheduleRow}><Text style={styles.scheduleLabel}>Skin check</Text><Text style={styles.scheduleTime}>8:30 PM</Text></View>
            <View style={styles.scheduleRow}><Text style={styles.scheduleLabel}>Water</Text><Text style={styles.scheduleTime}>8 AM–10 PM · 2h</Text></View>
          </View>
          <View style={styles.modeSection}>
            <Text style={styles.modeTitle}>Water reminder</Text>
            <View style={styles.modeChoices}>
              {([
                ['alarm', 'System alarm', 'clock'],
                ['notification', 'Notification', 'bell'],
              ] as const).map(([mode, label, icon]) => {
                const selected = waterReminderStyle === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onWaterReminderStyleChange(mode)}
                    style={[styles.modeChoice, selected && styles.modeChoiceSelected]}
                  >
                    <Feather name={icon} size={13} color={selected ? '#315d48' : '#8b958d'} />
                    <Text style={[styles.modeChoiceText, selected && styles.modeChoiceTextSelected]}>{label}</Text>
                    {selected ? <Feather name="check" size={12} color="#315d48" /> : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.modeHint}>A silent system alarm with an alarm screen. Your device may ask for exact-alarm access first.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isRequesting}
            onPress={requestPermission ? onEnable : onOpenSettings}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, isRequesting && styles.disabled]}
          >
            <Text style={styles.primaryText}>{isRequesting ? 'One moment…' : requestPermission ? 'Enable reminders' : 'Open notification settings'}</Text>
            {!isRequesting ? <Feather name={requestPermission ? 'bell' : 'settings'} size={15} color="#fff" /> : null}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.laterButton}>
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
          <Text style={styles.footnote}>You can edit reminders and their times later in Settings.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26, 38, 30, 0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 390, borderRadius: 26, backgroundColor: '#fbfbf8', borderWidth: 1, borderColor: '#e4e9e1', paddingHorizontal: 21, paddingTop: 22, paddingBottom: 17, alignItems: 'center', shadowColor: '#213528', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  icon: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#eaf1e9', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  eyebrow: { color: '#879388', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: '#25392c', fontFamily: 'Georgia', fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center', marginTop: 7 },
  body: { color: '#78847b', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 8, marginHorizontal: 3 },
  schedule: { width: '100%', backgroundColor: '#f2f5f0', borderRadius: 17, paddingHorizontal: 13, paddingVertical: 7, marginTop: 16, marginBottom: 15 },
  scheduleRow: { minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scheduleLabel: { color: '#5d6d61', fontSize: 10.5 },
  scheduleTime: { color: '#365440', fontSize: 10.5, fontWeight: '700' },
  modeSection: { width: '100%', marginBottom: 14 },
  modeTitle: { color: '#55665a', fontSize: 10, fontWeight: '700', marginBottom: 7 },
  modeChoices: { flexDirection: 'row', gap: 7 },
  modeChoice: { flex: 1, minHeight: 39, borderRadius: 13, borderWidth: 1, borderColor: '#e8ebe5', backgroundColor: '#fff', paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  modeChoiceSelected: { backgroundColor: '#eaf1e9', borderColor: '#adc1ad' },
  modeChoiceText: { color: '#879188', fontSize: 9.5, fontWeight: '600' },
  modeChoiceTextSelected: { color: '#315d48' },
  modeHint: { color: '#8a948c', fontSize: 9, lineHeight: 13, marginTop: 6 },
  primaryButton: { minHeight: 48, width: '100%', borderRadius: 16, backgroundColor: '#315d48', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  laterButton: { minHeight: 39, alignItems: 'center', justifyContent: 'center', marginTop: 3, paddingHorizontal: 20 },
  laterText: { color: '#718076', fontSize: 11, fontWeight: '600' },
  footnote: { color: '#9aa39b', fontSize: 9, marginTop: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.68 },
});
