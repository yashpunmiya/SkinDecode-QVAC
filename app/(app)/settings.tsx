import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useReminders } from '../../src/reminders/RemindersProvider';
import type { ReminderPreferences, WaterReminderStyle } from '../../src/reminders/models';

type TimeField = 'morningTimeMinutes' | 'eveningTimeMinutes' | 'skinCheckTimeMinutes' | 'waterStartMinutes' | 'waterEndMinutes';

function formatTime(value: number) {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function TimeEditor({ visible, initial, onClose, onSave }: { visible: boolean; initial: number; onClose: () => void; onSave: (value: number) => void }) {
  const [hourText, setHourText] = useState('09');
  const [minuteText, setMinuteText] = useState('00');
  const [isPm, setIsPm] = useState(false);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const valid = Number.isInteger(hour) && hour >= 1 && hour <= 12 && Number.isInteger(minute) && minute >= 0 && minute <= 59;

  useEffect(() => {
    if (!visible) return;
    const initialHour = Math.floor(initial / 60) % 24;
    setHourText(String(initialHour % 12 || 12).padStart(2, '0'));
    setMinuteText(String(initial % 60).padStart(2, '0'));
    setIsPm(initialHour >= 12);
  }, [initial, visible]);

  const save = () => {
    if (!valid) return;
    const hour24 = (hour % 12) + (isPm ? 12 : 0);
    onSave(hour24 * 60 + minute);
  };
  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 2);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.timeModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose a time</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close time picker" style={styles.closeButton}><Feather name="x" size={18} color="#536458" /></Pressable>
          </View>
          <View style={styles.timeWheel}>
            <View style={styles.timeInputGroup}>
              <Text style={styles.timeInputLabel}>HOUR</Text>
              <TextInput
                accessibilityLabel="Hour"
                value={hourText}
                onChangeText={(value) => setHourText(digitsOnly(value))}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                style={styles.timeInput}
              />
            </View>
            <Text style={styles.timeColon}>:</Text>
            <View style={styles.timeInputGroup}>
              <Text style={styles.timeInputLabel}>MIN</Text>
              <TextInput
                accessibilityLabel="Minute"
                value={minuteText}
                onChangeText={(value) => setMinuteText(digitsOnly(value))}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                style={styles.timeInput}
              />
            </View>
            <View style={styles.periodSwitch}>
              {(['AM', 'PM'] as const).map((period) => {
                const selected = (period === 'PM') === isPm;
                return <Pressable key={period} onPress={() => setIsPm(period === 'PM')} style={[styles.periodButton, selected && styles.periodButtonSelected]}>
                  <Text style={[styles.periodText, selected && styles.periodTextSelected]}>{period}</Text>
                </Pressable>;
              })}
            </View>
          </View>
          {!valid ? <Text style={styles.timeValidation}>Enter an hour from 1–12 and minutes from 00–59.</Text> : null}
          <Pressable disabled={!valid} style={[styles.saveTimeButton, !valid && styles.saveTimeButtonDisabled]} onPress={save}><Text style={styles.saveTimeText}>Set time</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function SettingsScreen() {
  const { preferences, permission, isLoading, error, updatePreferences, openSystemSettings } = useReminders();
  const [editing, setEditing] = useState<TimeField | null>(null);
  const [editingValue, setEditingValue] = useState(0);
  const update = (changes: Partial<ReminderPreferences>) => void updatePreferences({ ...preferences, ...changes });
  const invalidWaterWindow = preferences.waterEndMinutes <= preferences.waterStartMinutes;
  const timeRows: Array<{ label: string; key: TimeField }> = [
    { label: 'Reminder time', key: 'morningTimeMinutes' },
    { label: 'Reminder time', key: 'eveningTimeMinutes' },
    { label: 'Reminder time', key: 'skinCheckTimeMinutes' },
    { label: 'Start', key: 'waterStartMinutes' },
    { label: 'End', key: 'waterEndMinutes' },
  ];
  const openTime = (key: TimeField) => { setEditing(key); setEditingValue(preferences[key]); };
  const commitTime = (value: number) => {
    if (editing) update({ [editing]: value });
    setEditing(null);
  };
  const timeControl = (key: TimeField, label: string) => (
    <Pressable key={key} accessibilityRole="button" onPress={() => openTime(key)} style={styles.timeRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.timeValueWrap}><Text style={styles.timeValue}>{formatTime(preferences[key])}</Text><Feather name="chevron-right" size={15} color="#89948a" /></View>
    </Pressable>
  );
  const reminderToggle = (title: string, description: string, enabled: boolean, onChange: (value: boolean) => void, icon: React.ComponentProps<typeof Feather>['name']) => (
    <View style={styles.reminderHeader}>
      <View style={styles.reminderIcon}><Feather name={icon} size={16} color="#45654f" /></View>
      <View style={styles.reminderCopy}><Text style={styles.reminderTitle}>{title}</Text><Text style={styles.reminderDescription}>{description}</Text></View>
      <Switch value={enabled} onValueChange={onChange} trackColor={{ false: '#dce1dc', true: '#a9c4ac' }} thumbColor={enabled ? '#315d48' : '#fff'} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}><Feather name="arrow-left" size={18} color="#294334" /></Pressable>
          <Text style={styles.eyebrow}>PREFERENCES</Text>
          <View style={styles.backButtonPlaceholder} />
        </View>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>A few gentle nudges, on your schedule.</Text>

        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Reminders</Text><Feather name="bell" size={16} color="#66806b" /></View>
        {permission && !permission.granted && permission.status !== 'undetermined' ? (
          <Pressable onPress={() => void openSystemSettings()} style={styles.permissionNotice}>
            <View style={styles.noticeIcon}><Feather name="bell-off" size={15} color="#725f45" /></View>
            <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>Notifications are off</Text><Text style={styles.noticeBody}>Your choices stay saved here. Turn notifications on in system settings to receive them.</Text></View>
            <Feather name="chevron-right" size={16} color="#8d806a" />
          </Pressable>
        ) : null}
        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}

        <View style={styles.reminderCard}>
          {reminderToggle('Morning routine', 'A soft nudge to begin your routine.', preferences.morningEnabled, (value) => update({ morningEnabled: value }), 'sunrise')}
          {preferences.morningEnabled ? timeControl('morningTimeMinutes', 'Reminder time') : null}
        </View>
        <View style={styles.reminderCard}>
          {reminderToggle('Evening routine', 'A reminder to wind down with your routine.', preferences.eveningEnabled, (value) => update({ eveningEnabled: value }), 'moon')}
          {preferences.eveningEnabled ? timeControl('eveningTimeMinutes', 'Reminder time') : null}
        </View>
        <View style={styles.reminderCard}>
          {reminderToggle('Daily skin check', 'Compare yesterday with today.', preferences.skinCheckEnabled, (value) => update({ skinCheckEnabled: value }), 'aperture')}
          {preferences.skinCheckEnabled ? timeControl('skinCheckTimeMinutes', 'Reminder time') : null}
        </View>
        <View style={styles.reminderCard}>
          {reminderToggle('Water reminders', 'An occasional reminder during your day.', preferences.waterEnabled, (value) => update({ waterEnabled: value }), 'droplet')}
          {preferences.waterEnabled ? <>
            <View style={styles.styleRow}>
              <Text style={styles.rowLabel}>Reminder style</Text>
              <View style={styles.intervalOptions}>
                {([
                  ['alarm', 'System alarm'],
                  ['notification', 'Notification'],
                ] as const).map(([style, label]) => {
                  const selected = preferences.waterReminderStyle === style;
                  return (
                    <Pressable
                      key={style}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => update({ waterReminderStyle: style as WaterReminderStyle })}
                      style={[styles.intervalChip, selected && styles.intervalChipSelected]}
                    >
                      <Text style={[styles.intervalText, selected && styles.intervalTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Text style={styles.styleHint}>Silent system alarm with an alarm screen. Exact-alarm and full-screen access may be required.</Text>
            {timeControl('waterStartMinutes', timeRows[3]!.label)}
            {timeControl('waterEndMinutes', timeRows[4]!.label)}
            <View style={styles.intervalRow}>
              <Text style={styles.rowLabel}>Repeat every</Text>
              <View style={styles.intervalOptions}>
                {[2, 3].map((hours) => (
                  <Pressable key={hours} onPress={() => update({ waterIntervalHours: hours as 2 | 3 })} style={[styles.intervalChip, preferences.waterIntervalHours === hours && styles.intervalChipSelected]}>
                    <Text style={[styles.intervalText, preferences.waterIntervalHours === hours && styles.intervalTextSelected]}>{hours} hours</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {invalidWaterWindow ? <Text style={styles.validationText}>Choose an end time later than the start time.</Text> : null}
          </> : null}
        </View>
        <Text style={styles.localNote}><Feather name="smartphone" size={12} color="#879389" /> Stored and scheduled on this device</Text>
        {isLoading ? <Text style={styles.loadingText}>Loading your reminder settings…</Text> : null}
      </ScrollView>
      <TimeEditor visible={editing !== null} initial={editingValue} onClose={() => setEditing(null)} onSave={commitTime} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  content: { paddingHorizontal: 22, paddingTop: 7, paddingBottom: 38 },
  topBar: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 36, height: 36, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6eae4', alignItems: 'center', justifyContent: 'center' },
  backButtonPlaceholder: { width: 36 },
  eyebrow: { color: '#839086', fontSize: 9, fontWeight: '700', letterSpacing: 1.55 },
  title: { color: '#203329', fontSize: 30, lineHeight: 37, fontFamily: 'Georgia', fontWeight: '700', marginTop: 9 },
  subtitle: { color: '#768279', fontSize: 12, marginTop: 4, marginBottom: 23 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 2 },
  sectionTitle: { color: '#34453a', fontSize: 15, fontWeight: '700' },
  permissionNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f3eee4', borderColor: '#e9dfcd', borderWidth: 1, borderRadius: 17, padding: 12, marginBottom: 12 },
  noticeIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#fff9ed', alignItems: 'center', justifyContent: 'center' },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 11.5, color: '#514b3d', fontWeight: '700' },
  noticeBody: { fontSize: 10, color: '#827966', lineHeight: 14, marginTop: 3 },
  errorText: { color: '#a64d3d', fontSize: 11, lineHeight: 15, marginBottom: 9 },
  reminderCard: { backgroundColor: '#fff', borderRadius: 19, borderWidth: 1, borderColor: '#e8ebe5', paddingHorizontal: 14, paddingTop: 13, paddingBottom: 5, marginBottom: 10 },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 47 },
  reminderIcon: { width: 34, height: 34, borderRadius: 13, backgroundColor: '#edf3eb', alignItems: 'center', justifyContent: 'center' },
  reminderCopy: { flex: 1 },
  reminderTitle: { color: '#34453a', fontSize: 12.5, fontWeight: '700' },
  reminderDescription: { color: '#8a948c', fontSize: 10, lineHeight: 14, marginTop: 3 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f0f1ee', paddingVertical: 12, marginTop: 9 },
  rowLabel: { color: '#728077', fontSize: 11.5 },
  timeValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeValue: { color: '#365440', fontSize: 11.5, fontWeight: '700' },
  intervalRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f0f1ee', marginTop: 2 },
  styleRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f0f1ee', marginTop: 8 },
  styleHint: { color: '#8a948c', fontSize: 9, lineHeight: 13, marginTop: -2, marginBottom: 2 },
  intervalOptions: { flexDirection: 'row', gap: 7 },
  intervalChip: { borderRadius: 12, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: '#f4f5f1', borderWidth: 1, borderColor: '#eceee9' },
  intervalChipSelected: { backgroundColor: '#eaf1e9', borderColor: '#adc1ad' },
  intervalText: { color: '#7d8980', fontSize: 10, fontWeight: '600' },
  intervalTextSelected: { color: '#365440' },
  validationText: { color: '#a64d3d', fontSize: 10, paddingBottom: 8 },
  localNote: { color: '#879389', textAlign: 'center', fontSize: 10, marginTop: 8 },
  loadingText: { color: '#8a948c', fontSize: 10, textAlign: 'center', marginTop: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(26, 38, 30, 0.32)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  timeModal: { width: '100%', maxWidth: 360, borderRadius: 24, backgroundColor: '#fbfbf8', padding: 19, borderWidth: 1, borderColor: '#e4e9e1' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: '#2e4234', fontSize: 16, fontWeight: '700' },
  closeButton: { width: 31, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2ec' },
  timeWheel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 21 },
  timeInputGroup: { width: 72, height: 67, borderRadius: 16, backgroundColor: '#f0f4ee', borderWidth: 1, borderColor: '#e2e9df', alignItems: 'center', justifyContent: 'center' },
  timeInputLabel: { color: '#879389', fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginBottom: -1 },
  timeInput: { color: '#263d2e', fontSize: 29, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center', width: '100%', paddingVertical: 0, includeFontPadding: false },
  timeColon: { fontSize: 29, fontWeight: '500', color: '#718177', marginTop: 17 },
  periodSwitch: { marginLeft: 2, borderRadius: 13, backgroundColor: '#edf1eb', padding: 3, gap: 2 },
  periodButton: { minWidth: 42, paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  periodButtonSelected: { backgroundColor: '#315d48' },
  periodText: { color: '#718077', fontSize: 10, fontWeight: '700' },
  periodTextSelected: { color: '#fff' },
  timeValidation: { color: '#a64d3d', fontSize: 10, textAlign: 'center', marginTop: -10, marginBottom: 10 },
  saveTimeButton: { minHeight: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#315d48' },
  saveTimeButtonDisabled: { opacity: 0.45 },
  saveTimeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
