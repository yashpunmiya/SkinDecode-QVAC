import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { useRoutine } from '../../../src/routine/RoutineProvider';
import { getAdherence, localDateKey } from '../../../src/routine/models';

const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function RoutineHistoryScreen() {
  const router = useRouter();
  const { status, snapshot } = useRoutine();
  const today = new Date();
  const todayKey = localDateKey(today);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const firstDate = useMemo(() => new Date(month.getFullYear(), month.getMonth(), 1), [month]);
  const monthLength = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startOffset = (firstDate.getDay() + 6) % 7;
  const monthDates = Array.from({ length: monthLength }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
  const calendarItems: (Date | null)[] = [...Array.from({ length: startOffset }, () => null), ...monthDates];
  while (calendarItems.length % 7 !== 0) calendarItems.push(null);

  const visibleSteps = snapshot.steps.filter((step) => step.enabled && !step.deletedAt);
  const visibleLogs = snapshot.logs.filter((log) => !log.deletedAt);
  const firstRoutineDate = snapshot.routines
    .filter((routine) => routine.isActive && !routine.deletedAt)
    .map((routine) => new Date(routine.createdAt))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const start = firstRoutineDate && firstRoutineDate > firstDate ? firstRoutineDate : firstDate;
  const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const monthEnd = new Date(month.getFullYear(), month.getMonth(), isCurrentMonth ? today.getDate() : monthLength);
  const monthSummary = month.getFullYear() > today.getFullYear()
    || (month.getFullYear() === today.getFullYear() && month.getMonth() > today.getMonth())
    ? { due: 0, completed: 0, percentage: 0 }
    : getAdherence(visibleLogs, visibleSteps, start, monthEnd);

  const selected = new Date(`${selectedDate}T12:00:00`);
  const daySummary = getAdherence(visibleLogs, visibleSteps, selected, selected);
  const dayLogs = visibleLogs.filter((log) => log.logDate === selectedDate);
  const skippedCount = dayLogs.filter((log) => log.status === 'skipped').length;
  const canGoForward = month.getFullYear() < today.getFullYear()
    || (month.getFullYear() === today.getFullYear() && month.getMonth() < today.getMonth());

  const changeMonth = (offset: -1 | 1) => {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    const day = Math.min(Number(selectedDate.slice(-2)), new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate());
    const nextDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
    if (localDateKey(nextDate) > todayKey) nextDate.setTime(today.getTime());
    setSelectedDate(localDateKey(nextDate));
    setMonth(nextMonth);
  };

  if (status === 'loading') return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}>
            <Feather name="arrow-left" size={21} color="#25362b" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR HABIT, OVER TIME</Text>
            <Text style={styles.title}>History</Text>
          </View>
          <View style={styles.headerMark}><Feather name="calendar" size={18} color="#4d6a53" /></View>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}><Feather name="activity" size={17} color="#4d6a53" /></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryLabel}>THIS MONTH</Text>
            <Text style={styles.summaryTitle}>{monthSummary.due ? `${monthSummary.percentage}% of steps completed` : 'Your history starts here'}</Text>
            <Text style={styles.summarySubtitle}>
              {monthSummary.due ? `${monthSummary.completed} of ${monthSummary.due} scheduled steps` : 'Complete a routine step to begin your calendar.'}
            </Text>
          </View>
          <Text style={styles.summaryPercent}>{monthSummary.due ? `${monthSummary.percentage}%` : '—'}</Text>
        </View>

        <View style={styles.calendarCard}>
          <View style={styles.monthHeader}>
            <Text style={styles.monthTitle}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <View style={styles.monthControls}>
              <Pressable onPress={() => changeMonth(-1)} accessibilityLabel="Previous month" style={styles.monthButton}>
                <Feather name="chevron-left" size={17} color="#617168" />
              </Pressable>
              <Pressable onPress={() => changeMonth(1)} disabled={!canGoForward} accessibilityLabel="Next month" style={[styles.monthButton, !canGoForward && styles.monthButtonDisabled]}>
                <Feather name="chevron-right" size={17} color={canGoForward ? '#617168' : '#c4cbc4'} />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekdayRow}>
            {weekdayLabels.map((label, index) => <Text key={`${label}-${index}`} style={styles.weekday}>{label}</Text>)}
          </View>
          <View style={styles.calendarGrid}>
            {calendarItems.map((date, index) => {
              if (!date) return <View key={`empty-${index}`} style={styles.dateCell} />;
              const dateKey = localDateKey(date);
              const future = dateKey > todayKey;
              const active = selectedDate === dateKey;
              const day = getAdherence(visibleLogs, visibleSteps, date, date);
              const hasLogs = visibleLogs.some((log) => log.logDate === dateKey);
              return (
                <Pressable
                  key={dateKey}
                  disabled={future}
                  accessibilityRole="button"
                  accessibilityLabel={`${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, ${day.percentage}% complete`}
                  accessibilityState={{ selected: active, disabled: future }}
                  onPress={() => setSelectedDate(dateKey)}
                  style={styles.dateCell}
                >
                  <View style={[styles.dateBubble, active && styles.dateBubbleActive, future && styles.dateBubbleFuture]}>
                    <Text style={[styles.dateText, active && styles.dateTextActive, future && styles.dateTextFuture]}>{date.getDate()}</Text>
                  </View>
                  <View style={[styles.adherenceDot, hasLogs && styles.adherenceDotLogged, day.percentage === 100 && day.due > 0 && styles.adherenceDotComplete]} />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.legendRow}>
            <View style={styles.legendDot} />
            <Text style={styles.legendText}>A mark means you checked in that day</Text>
          </View>
        </View>

        <View style={styles.dayDetail}>
          <View style={styles.detailHeader}>
            <View>
              <Text style={styles.detailEyebrow}>SELECTED DAY</Text>
              <Text style={styles.detailTitle}>{selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
            </View>
            <View style={styles.dayPercentBadge}>
              <Text style={styles.dayPercent}>{daySummary.due ? `${daySummary.percentage}%` : '—'}</Text>
              <Text style={styles.dayPercentLabel}>adherence</Text>
            </View>
          </View>
          {daySummary.due ? (
            <Text style={styles.detailBody}>
              {daySummary.completed} of {daySummary.due} steps complete{skippedCount ? ` · ${skippedCount} skipped` : ''}
            </Text>
          ) : (
            <Text style={styles.detailBody}>No routine steps were scheduled for this day.</Text>
          )}
        </View>
        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  content: { flexGrow: 1, paddingHorizontal: 21, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6, marginBottom: 18 },
  backButton: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#839086', fontSize: 9, fontWeight: '700', letterSpacing: 1.45 },
  title: { color: '#203329', fontSize: 27, lineHeight: 31, fontFamily: 'Georgia', fontWeight: '700' },
  headerMark: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eaf1e9' },
  summaryCard: { minHeight: 100, flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  summaryIcon: { width: 36, height: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' },
  summaryCopy: { flex: 1, paddingHorizontal: 11 },
  summaryLabel: { color: '#8b968d', fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2 },
  summaryTitle: { color: '#2b3c30', fontSize: 13, fontWeight: '700', marginTop: 4 },
  summarySubtitle: { color: '#879188', fontSize: 10, marginTop: 3 },
  summaryPercent: { color: '#47684e', fontSize: 18, fontFamily: 'Georgia', fontWeight: '700' },
  calendarCard: { padding: 15, marginTop: 14, borderRadius: 21, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  monthTitle: { color: '#2a3b30', fontSize: 15, fontWeight: '700' },
  monthControls: { flexDirection: 'row', gap: 5 },
  monthButton: { width: 29, height: 29, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6f2' },
  monthButtonDisabled: { backgroundColor: '#fafaf8' },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: '#9aa39c', fontSize: 9, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dateCell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dateBubble: { width: 30, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dateBubbleActive: { backgroundColor: '#31543b' },
  dateBubbleFuture: { opacity: 0.4 },
  dateText: { color: '#4b594f', fontSize: 11.5, fontWeight: '500' },
  dateTextActive: { color: '#fff', fontWeight: '700' },
  dateTextFuture: { color: '#adb5ad' },
  adherenceDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  adherenceDotLogged: { backgroundColor: '#c8a278' },
  adherenceDotComplete: { backgroundColor: '#6f936f' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#edf0eb', marginTop: 5 },
  legendDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#c8a278' },
  legendText: { color: '#949e96', fontSize: 9.5 },
  dayDetail: { marginTop: 14, padding: 16, borderRadius: 19, backgroundColor: '#edf2ec', borderWidth: 1, borderColor: '#e3ebe2' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailEyebrow: { color: '#7c8d7e', fontSize: 8.5, fontWeight: '700', letterSpacing: 1.1 },
  detailTitle: { color: '#2e4334', fontSize: 15, fontWeight: '700', marginTop: 4 },
  dayPercentBadge: { minWidth: 55, alignItems: 'center' },
  dayPercent: { color: '#46694d', fontSize: 18, fontFamily: 'Georgia', fontWeight: '700' },
  dayPercentLabel: { color: '#829084', fontSize: 8.5 },
  detailBody: { color: '#718174', fontSize: 11, marginTop: 11 },
  bottomSpace: { height: 15 },
});
