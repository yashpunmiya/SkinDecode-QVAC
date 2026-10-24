import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { RoutineStepCard } from './RoutineStepCard';
import { LoadingScreen } from '../LoadingScreen';
import { useReducedMotion } from '../useReducedMotion';
import { useRoutine } from '../../routine/RoutineProvider';
import { getStreak, localDateKey, type RoutinePeriod, type RoutineStep } from '../../routine/models';
import { getCachedProductIntelligence, getRoutineProductSummaries } from '../../products/catalog-service';
import { productIntelligenceSummary } from '../../products/product-intelligence';
import type { ProductSummary } from '../../products/types';

function PeriodSwitch({ value, onChange }: { value: RoutinePeriod; onChange: (value: RoutinePeriod) => void }) {
  const progress = useRef(new Animated.Value(value === 'am' ? 0 : 1)).current;
  const [segmentWidth, setSegmentWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(value === 'am' ? 0 : 1);
      return;
    }
    Animated.spring(progress, { toValue: value === 'am' ? 0 : 1, speed: 19, bounciness: 2, useNativeDriver: true }).start();
  }, [progress, reduceMotion, value]);

  return (
    <View style={styles.periodSwitch} accessibilityRole="tablist" onLayout={(event) => setSegmentWidth(Math.max(0, (event.nativeEvent.layout.width - 8) / 2))}>
      <Animated.View
        pointerEvents="none"
        style={[styles.periodHighlight, { width: segmentWidth, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, segmentWidth + 8] }) }] }]}
      />
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === 'am' }} onPress={() => onChange('am')} style={styles.periodOption}>
        <View style={[styles.periodIcon, styles.periodSunIcon, value === 'am' && styles.periodIconActive]}>
          <Feather name="sun" size={16} color={value === 'am' ? '#8b6d32' : '#8c958b'} />
        </View>
        <View style={styles.periodCopy}>
          <Text style={[styles.periodLabel, value === 'am' && styles.periodLabelActive]}>Morning</Text>
          <Text style={[styles.periodHint, value === 'am' && styles.periodHintActive]}>AM · Start fresh</Text>
        </View>
        <View style={styles.periodMarkSlot}>{value === 'am' ? <View style={styles.periodSelectedMark}><Feather name="check" size={11} color="#fff" /></View> : null}</View>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === 'pm' }} onPress={() => onChange('pm')} style={styles.periodOption}>
        <View style={[styles.periodIcon, styles.periodMoonIcon, value === 'pm' && styles.periodIconActive]}>
          <Feather name="moon" size={16} color={value === 'pm' ? '#536e79' : '#8c958b'} />
        </View>
        <View style={styles.periodCopy}>
          <Text style={[styles.periodLabel, value === 'pm' && styles.periodLabelActive]}>Evening</Text>
          <Text style={[styles.periodHint, value === 'pm' && styles.periodHintActive]}>PM · Wind down</Text>
        </View>
        <View style={styles.periodMarkSlot}>{value === 'pm' ? <View style={[styles.periodSelectedMark, styles.periodSelectedMarkEvening]}><Feather name="check" size={11} color="#fff" /></View> : null}</View>
      </Pressable>
    </View>
  );
}

export function RoutineTodayScreen({ showBackButton = true }: { showBackButton?: boolean }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { status, error, syncError, isSyncing, snapshot, activeRoutineId, stepsForPeriod, refresh, retrySync, setStepStatus } = useRoutine();
  const [period, setPeriod] = useState<RoutinePeriod>(() => new Date().getHours() < 16 ? 'am' : 'pm');
  const [operationError, setOperationError] = useState<string | null>(null);
  const [linkedProducts, setLinkedProducts] = useState<Record<string, ProductSummary>>({});
  const [productMatchLabels, setProductMatchLabels] = useState<Record<string, string>>({});
  const linkedProductsRef = useRef<Record<string, ProductSummary>>({});
  const productMatchLabelsRef = useRef<Record<string, string>>({});
  const linkedProductSignaturesRef = useRef<Record<string, string>>({});
  const linkedProductsOwnerRef = useRef(userId);
  const [celebration, setCelebration] = useState(false);
  const progressValue = useRef(new Animated.Value(0)).current;
  const celebrationValue = useRef(new Animated.Value(0)).current;
  const lastSession = useRef<{ key: string; complete: boolean } | null>(null);
  const today = new Date();
  const todayKey = localDateKey(today);
  const scheduledSteps = useMemo(
    () => stepsForPeriod(period).filter((step) => step.daysOfWeek.includes(today.getDay())),
    [period, stepsForPeriod, todayKey],
  );
  const logs = snapshot.logs.filter((log) => log.deletedAt === null && log.logDate === todayKey);
  const statusFor = (step: RoutineStep) => logs.find((log) => log.stepId === step.id)?.status ?? null;
  const completedCount = scheduledSteps.filter((step) => statusFor(step) === 'completed').length;
  const skippedCount = scheduledSteps.filter((step) => statusFor(step) === 'skipped').length;
  const progress = scheduledSteps.length ? completedCount / scheduledSteps.length : 0;
  const isComplete = scheduledSteps.length > 0 && completedCount === scheduledSteps.length;
  const streak = getStreak(snapshot.logs.filter((log) => log.deletedAt === null), snapshot.steps, period);
  const sessionKey = `${todayKey}-${period}`;
  const linkedProductsKey = useMemo(() => snapshot.steps
    .filter((step) => step.productId !== null || step.shelfItemId !== null)
    .map((step) => `${step.id}:${step.productId ?? ''}:${step.shelfItemId ?? ''}`).sort().join('|'), [snapshot.steps]);
  const snapshotStepsRef = useRef(snapshot.steps);
  snapshotStepsRef.current = snapshot.steps;

  useEffect(() => {
    if (linkedProductsOwnerRef.current === userId) return;
    linkedProductsOwnerRef.current = userId;
    linkedProductsRef.current = {};
    productMatchLabelsRef.current = {};
    linkedProductSignaturesRef.current = {};
    setLinkedProducts({});
    setProductMatchLabels({});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const linkedSteps = snapshotStepsRef.current.filter((step) => step.productId !== null || step.shelfItemId !== null);
    const linkedStepIds = new Set(linkedSteps.map((step) => step.id));
    const staleStepIds = Object.keys(linkedProductSignaturesRef.current).filter((stepId) => !linkedStepIds.has(stepId));
    if (staleStepIds.length) {
      for (const stepId of staleStepIds) {
        delete linkedProductSignaturesRef.current[stepId];
        delete linkedProductsRef.current[stepId];
        delete productMatchLabelsRef.current[stepId];
      }
      setLinkedProducts((current) => Object.fromEntries(Object.entries(current).filter(([stepId]) => linkedStepIds.has(stepId))));
      setProductMatchLabels((current) => Object.fromEntries(Object.entries(current).filter(([stepId]) => linkedStepIds.has(stepId))));
    }
    if (!linkedProductsKey) return;
    let active = true;
    const stepsToFetch = linkedSteps.filter((step) => {
      const signature = `${step.productId ?? ''}:${step.shelfItemId ?? ''}`;
      return linkedProductSignaturesRef.current[step.id] !== signature || !linkedProductsRef.current[step.id];
    });
    if (!stepsToFetch.length) return;
    void getRoutineProductSummaries(userId, stepsToFetch).then((products) => {
      if (!active) return;
      for (const step of stepsToFetch) {
        linkedProductSignaturesRef.current[step.id] = `${step.productId ?? ''}:${step.shelfItemId ?? ''}`;
      }
      const resolved = Object.fromEntries(products);
      linkedProductsRef.current = { ...linkedProductsRef.current, ...resolved };
      setLinkedProducts((current) => ({ ...current, ...resolved }));
      const compactIds = [...products.values()].filter((product) => !product.isLegacySnapshot).map((product) => product.productId);
      if (!compactIds.length) return;
      void getCachedProductIntelligence(userId, compactIds).then((scores) => {
        if (!active) return;
        const labels = new Map([...scores].flatMap(([id, score]) => {
          const label = productIntelligenceSummary(score);
          return label ? [[id, label] as const] : [];
        }));
        const resolvedLabels = Object.fromEntries([...products].flatMap(([stepId, product]) => {
          const label = labels.get(product.productId);
          return label ? [[stepId, label] as const] : [];
        }));
        productMatchLabelsRef.current = { ...productMatchLabelsRef.current, ...resolvedLabels };
        setProductMatchLabels((current) => ({ ...current, ...resolvedLabels }));
      }).catch(() => undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [linkedProductsKey, userId]);

  useEffect(() => {
    Animated.timing(progressValue, { toValue: progress, duration: 360, useNativeDriver: false }).start();
  }, [progress, progressValue]);

  useEffect(() => {
    if (status !== 'ready') return;
    const previous = lastSession.current;
    if (!previous || previous.key !== sessionKey) {
      lastSession.current = { key: sessionKey, complete: isComplete };
      setCelebration(false);
      celebrationValue.setValue(0);
      return;
    }
    if (isComplete && !previous.complete) {
      setCelebration(true);
      Animated.spring(celebrationValue, { toValue: 1, speed: 16, bounciness: 5, useNativeDriver: true }).start();
    } else if (!isComplete && previous.complete) {
      setCelebration(false);
      celebrationValue.setValue(0);
    }
    lastSession.current = { key: sessionKey, complete: isComplete };
  }, [celebrationValue, isComplete, sessionKey, status]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState}>
          <View style={styles.stateIcon}><Feather name="cloud-off" size={22} color="#536f59" /></View>
          <Text style={styles.stateTitle}>Your routine is just out of reach</Text>
          <Text style={styles.stateBody}>{error}</Text>
          <Pressable onPress={() => void refresh()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const progressWidth = progressValue.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const celebrationStyle = {
    opacity: celebrationValue,
    transform: [{ scale: celebrationValue.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
  };

  const onStatusChange = async (step: RoutineStep, nextStatus: 'completed' | 'skipped' | null) => {
    setOperationError(null);
    try {
      await setStepStatus(step, nextStatus, today);
    } catch {
      setOperationError('This update could not be saved. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, !showBackButton && styles.tabContent]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {showBackButton ? (
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}>
              <Feather name="arrow-left" size={21} color="#25362b" />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR DAILY RITUAL</Text>
            <Text style={styles.title}>Today</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/routine/history')} accessibilityRole="button" accessibilityLabel="Routine history" style={styles.iconButton}>
              <Feather name="calendar" size={18} color="#3f5746" />
            </Pressable>
            <Pressable onPress={() => router.push('/routine/edit')} accessibilityRole="button" accessibilityLabel="Edit routine" style={styles.iconButton}>
              <Feather name="sliders" size={18} color="#3f5746" />
            </Pressable>
          </View>
        </View>

        <Text style={styles.dateText}>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>

        {syncError ? (
          <Pressable onPress={() => void retrySync()} style={styles.syncBanner} accessibilityRole="button" accessibilityLabel="Retry routine backup">
            <Feather name={isSyncing ? 'refresh-cw' : 'cloud-off'} size={14} color="#7d7158" />
            <Text style={styles.syncBannerText}>{isSyncing ? 'Syncing your routine…' : syncError}</Text>
            {!isSyncing ? <Feather name="rotate-cw" size={14} color="#7d7158" /> : null}
          </Pressable>
        ) : null}

        <PeriodSwitch value={period} onChange={setPeriod} />

        <View style={styles.progressCard}>
          <View style={styles.progressTop}>
            <View style={styles.progressCopy}>
              <Text style={styles.progressEyebrow}>{period === 'am' ? 'A GENTLE START' : 'WINDING DOWN'}</Text>
              <Text style={styles.progressTitle}>{isComplete ? 'Beautifully done.' : 'One step at a time.'}</Text>
              <Text style={styles.progressSubtitle}>
                {scheduledSteps.length ? `${completedCount} of ${scheduledSteps.length} steps complete` : 'A little space to reset today'}
                {skippedCount ? ` · ${skippedCount} skipped` : ''}
              </Text>
            </View>
            <View style={styles.streakBadge}>
              <Feather name="zap" size={14} color="#a9794d" />
              <Text style={styles.streakCount}>{streak}</Text>
              <Text style={styles.streakLabel}>day streak</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          {celebration ? (
            <Animated.View style={[styles.celebration, celebrationStyle]}>
              <View style={styles.celebrationMark}><Feather name="star" size={12} color="#fff" /></View>
              <Text style={styles.celebrationText}>Your {period === 'am' ? 'morning' : 'evening'} ritual is complete. Lovely work.</Text>
            </Animated.View>
          ) : null}
        </View>

        <View style={styles.listHeader}>
          <View>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>{period === 'am' ? 'Morning' : 'Evening'}</Text>
              <Feather name={period === 'am' ? 'sun' : 'moon'} size={16} color="#8b9b83" />
            </View>
          </View>
          <Text style={styles.stepCount}>{scheduledSteps.length} {scheduledSteps.length === 1 ? 'step' : 'steps'}</Text>
        </View>

        {operationError ? <Text style={styles.errorText}>{operationError}</Text> : null}
        {scheduledSteps.length ? (
          <View style={styles.stepsList}>
            {scheduledSteps.map((step, index) => (
              <RoutineStepCard
                key={step.id}
                step={step}
                order={index + 1}
                isLast={index === scheduledSteps.length - 1}
                product={linkedProducts[step.id]}
                productMatchLabel={productMatchLabels[step.id]}
                onProductPress={linkedProducts[step.id] ? () => router.push({ pathname: '/products/[productId]', params: { productId: String(linkedProducts[step.id]!.productId), ...(linkedProducts[step.id]!.isLegacySnapshot ? { source: 'legacy' } : {}) } } as Href) : undefined}
                status={statusFor(step)}
                onToggle={() => void onStatusChange(step, statusFor(step) === 'completed' ? null : 'completed')}
                onSetStatus={(next) => void onStatusChange(step, next)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.restCard}>
            <View style={styles.restIcon}><Feather name="feather" size={19} color="#66806b" /></View>
            <Text style={styles.restTitle}>A rest day for this routine</Text>
            <Text style={styles.restBody}>Nothing is scheduled for this day. Your routine is right where you left it.</Text>
            <Pressable onPress={() => router.push('/routine/edit')} style={styles.restAction}>
              <Text style={styles.restActionText}>Adjust schedule</Text>
              <Feather name="arrow-right" size={14} color="#45634c" />
            </Pressable>
          </View>
        )}

        <View style={styles.bottomHint}>
          <Feather name="heart" size={14} color="#7d967f" />
          <Text style={styles.bottomHintText}>Consistency can be gentle.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  content: { flexGrow: 1, paddingHorizontal: 21, paddingBottom: 36 },
  tabContent: { paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 },
  backButton: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#839086', fontSize: 9, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: '#203329', fontSize: 27, lineHeight: 31, fontFamily: 'Georgia', fontWeight: '700', letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', gap: 7 },
  iconButton: { width: 37, height: 37, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  dateText: { color: '#78847b', fontSize: 13, marginTop: 11, marginBottom: 16 },
  syncBanner: { minHeight: 37, marginBottom: 12, borderRadius: 12, paddingHorizontal: 10, gap: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f4efe5' },
  syncBannerText: { flex: 1, color: '#786c54', fontSize: 10.5, lineHeight: 15 },
  periodSwitch: { flexDirection: 'row', gap: 8, position: 'relative', marginBottom: 15 },
  periodHighlight: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 18, backgroundColor: '#f0f5ee', borderWidth: 1, borderColor: '#aebfae' },
  periodOption: { flex: 1, minWidth: 0, minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 9, zIndex: 1 },
  periodIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  periodSunIcon: { backgroundColor: '#f8f2df' },
  periodMoonIcon: { backgroundColor: '#edf0f2' },
  periodIconActive: { backgroundColor: '#fff' },
  periodCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  periodLabel: { color: '#526056', fontSize: 12.5, fontWeight: '700' },
  periodLabelActive: { color: '#263c2c' },
  periodHint: { color: '#8a938a', fontSize: 9, lineHeight: 13, marginTop: 2 },
  periodHintActive: { color: '#667568' },
  periodMarkSlot: { width: 18, height: 18 },
  periodSelectedMark: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#31543b' },
  periodSelectedMarkEvening: { backgroundColor: '#496775' },
  progressCard: { padding: 17, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5', shadowColor: '#21342a', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 13, elevation: 2 },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  progressCopy: { flex: 1 },
  progressEyebrow: { color: '#839086', fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  progressTitle: { color: '#203329', fontFamily: 'Georgia', fontSize: 20, lineHeight: 25, marginTop: 4 },
  progressSubtitle: { color: '#7f8981', fontSize: 11.5, marginTop: 4 },
  streakBadge: { minWidth: 66, minHeight: 57, borderRadius: 16, backgroundColor: '#f8f3e9', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, paddingVertical: 5 },
  streakCount: { color: '#725a3d', fontSize: 15, fontWeight: '700', marginTop: 1 },
  streakLabel: { color: '#927f65', fontSize: 8.5, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#edf0eb', overflow: 'hidden', marginTop: 15 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#6c8b6e' },
  celebration: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e7eee5' },
  celebrationMark: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#799779' },
  celebrationText: { color: '#4d6b52', fontSize: 11, fontWeight: '600' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 23, marginBottom: 11, paddingHorizontal: 2 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { color: '#26372c', fontSize: 18, fontWeight: '700', letterSpacing: -0.25 },
  stepCount: { color: '#7d897f', fontSize: 11, fontWeight: '600' },
  stepsList: { overflow: 'hidden', borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e9ebe5' },
  restCard: { minHeight: 204, padding: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  restIcon: { width: 44, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' },
  restTitle: { color: '#2b3e30', fontSize: 15, fontWeight: '700', marginTop: 12 },
  restBody: { color: '#859087', fontSize: 11.5, lineHeight: 17, textAlign: 'center', maxWidth: 240, marginTop: 6 },
  restAction: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15, paddingVertical: 8, paddingHorizontal: 12 },
  restActionText: { color: '#45634c', fontSize: 11.5, fontWeight: '700' },
  errorText: { color: '#a44c3e', fontSize: 11.5, marginBottom: 8 },
  bottomHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 22 },
  bottomHintText: { color: '#8a948c', fontSize: 10.5 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  stateIcon: { width: 54, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eaf0e9' },
  stateTitle: { color: '#26372c', fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 16 },
  stateBody: { color: '#7d8980', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  retryButton: { marginTop: 18, borderRadius: 15, paddingHorizontal: 21, paddingVertical: 11, backgroundColor: '#31543b' },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
