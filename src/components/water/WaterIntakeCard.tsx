import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MAX_WATER_GOAL } from '../../water/water-tracker';
import { useWaterTracker } from '../../water/useWaterTracker';

type WaterIntakeCardProps = { userId?: string };

export function WaterIntakeCard({ userId }: WaterIntakeCardProps) {
  const tracker = useWaterTracker(userId);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalDraft, setGoalDraft] = useState(tracker.goal);
  const progress = useRef(new Animated.Value(0)).current;
  const progressRatio = tracker.goal > 0 ? Math.min(1, tracker.glasses / tracker.goal) : 0;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: progressRatio,
      duration: 520,
      useNativeDriver: false,
    }).start();
  }, [progress, progressRatio]);

  const addGlass = () => {
    tracker.addGlass();
  };

  const openGoalEditor = () => {
    setGoalDraft(tracker.goal);
    setGoalModalVisible(true);
  };

  const saveGoal = () => {
    tracker.setGoal(goalDraft);
    setGoalModalVisible(false);
  };

  const amountMl = tracker.glasses * 250;
  const remaining = Math.max(0, tracker.goal - tracker.glasses);

  return (
    <>
      <View style={styles.card}>
        <View pointerEvents="none" style={styles.mascotClip}>
          <Image
            source={require('../../assets/mascot/mascot_water.png')}
            style={styles.mascot}
            resizeMode="contain"
            accessibilityLabel="SkinDecode water mascot holding a glass"
          />
        </View>
        <View style={styles.cardHeader}>
          <View style={styles.headingGroup}>
            <View style={styles.headingIcon}><Feather name="droplet" size={14} color="#4f7c8a" /></View>
            <Text style={styles.heading}>Water today</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit daily water goal, currently ${tracker.goal} glasses`}
              onPress={openGoalEditor}
              hitSlop={6}
              style={({ pressed }) => [styles.goalEditButton, pressed && styles.pressed]}
            >
              <Feather name="edit-2" size={11} color="#718179" />
            </Pressable>
          </View>
        </View>

        <View style={styles.heroRow}>
          <View style={styles.progressCopy}>
            <View style={styles.countRow}>
              <Text style={styles.glassCount}>{tracker.isLoading ? '—' : tracker.glasses}</Text>
              <Text style={styles.countGoal}>/ {tracker.goal} glasses</Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Water goal progress"
              accessibilityValue={{ min: 0, max: tracker.goal, now: Math.min(tracker.glasses, tracker.goal) }}
              style={styles.progressTrack}
            >
              <Animated.View style={[styles.progressFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            </View>
            <Text style={styles.volumeText}>{amountMl.toLocaleString()} ml · {remaining > 0 ? `${remaining} to go` : 'goal met'}</Text>
          </View>
        </View>
        {tracker.error ? (
          <Pressable onPress={tracker.retrySave} accessibilityRole="button" style={styles.errorRow}>
            <Feather name="alert-circle" size={13} color="#a65d4f" />
            <Text style={styles.errorText}>{tracker.error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove one glass of water"
            accessibilityState={{ disabled: tracker.isLoading || tracker.glasses === 0 }}
            disabled={tracker.isLoading || tracker.glasses === 0}
            onPress={tracker.removeGlass}
            style={({ pressed }) => [styles.undoButton, (pressed && tracker.glasses > 0) && styles.pressed, (tracker.isLoading || tracker.glasses === 0) && styles.buttonDisabled]}
          >
            <Feather name="minus" size={17} color="#60747a" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add one glass of water"
            accessibilityHint="Adds one glass to today’s locally saved tracker"
            accessibilityState={{ disabled: tracker.isLoading }}
            disabled={tracker.isLoading}
            onPress={addGlass}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed, tracker.isLoading && styles.buttonDisabled]}
          >
            {tracker.isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="plus" size={17} color="#fff" />}
            <Text style={styles.addButtonText}>Add a glass</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={goalModalVisible} transparent animationType="fade" onRequestClose={() => setGoalModalVisible(false)} statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setGoalModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close water goal settings" />
          <View style={styles.goalModal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>YOUR DAILY TARGET</Text>
                <Text style={styles.modalTitle}>Set your water goal</Text>
              </View>
              <Pressable onPress={() => setGoalModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close" style={styles.modalClose}>
                <Feather name="x" size={17} color="#526858" />
              </Pressable>
            </View>
            <Text style={styles.modalHint}>Choose how many glasses you’d like to track each day.</Text>
            <View style={styles.goalStepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease water goal"
                accessibilityState={{ disabled: goalDraft <= 1 }}
                disabled={goalDraft <= 1}
                onPress={() => setGoalDraft((goal) => Math.max(1, goal - 1))}
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed, goalDraft <= 1 && styles.buttonDisabled]}
              ><Feather name="minus" size={20} color="#42604b" /></Pressable>
              <View style={styles.goalValueWrap}>
                <Text style={styles.goalValue}>{goalDraft}</Text>
                <Text style={styles.goalUnit}>glasses a day</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase water goal"
                accessibilityState={{ disabled: goalDraft >= MAX_WATER_GOAL }}
                disabled={goalDraft >= MAX_WATER_GOAL}
                onPress={() => setGoalDraft((goal) => Math.min(MAX_WATER_GOAL, goal + 1))}
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed, goalDraft >= MAX_WATER_GOAL && styles.buttonDisabled]}
              ><Feather name="plus" size={20} color="#42604b" /></Pressable>
            </View>
            <Text style={styles.modalFootnote}>One glass is counted as 250 ml. Adjust this goal whenever you like.</Text>
            <Pressable onPress={saveGoal} accessibilityRole="button" style={({ pressed }) => [styles.saveGoalButton, pressed && styles.pressed]}>
              <Text style={styles.saveGoalText}>Save daily goal</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'visible',
    position: 'relative',
    padding: 12,
    marginTop: 0,
    borderRadius: 21,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9ebe5',
    shadowColor: '#19352b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 11,
    elevation: 2,
  },
  cardHeader: { minHeight: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, zIndex: 2 },
  headingGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e8f2ee' },
  heading: { color: '#26382f', fontSize: 13, fontWeight: '700' },
  goalEditButton: { width: 23, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#f4f6f3' },
  heroRow: { height: 69, flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  progressCopy: { width: '55%', zIndex: 1, paddingVertical: 3 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glassCount: { color: '#1f3429', fontSize: 36, lineHeight: 40, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -1.3 },
  countGoal: { color: '#45564b', fontSize: 10.5, fontWeight: '600' },
  volumeText: { color: '#87938a', fontSize: 9, marginTop: 4 },
  progressTrack: { height: 6, overflow: 'hidden', marginTop: 4, borderRadius: 5, backgroundColor: '#e9f0ed' },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#79a99b' },
  mascotClip: { position: 'absolute', width: 146, top: -25, bottom: 0, right: -12, overflow: 'hidden', zIndex: 1 },
  mascot: { position: 'absolute', width: 235, height: 235, top: 0, right: -34 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, zIndex: 2 },
  errorText: { flex: 1, color: '#9b5b50', fontSize: 9.5, lineHeight: 14 },
  actions: { width: '55%', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, zIndex: 2 },
  undoButton: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#e4ece8', backgroundColor: '#fff' },
  addButton: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: '#315d50', shadowColor: '#315d50', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 7, elevation: 2 },
  addButtonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  buttonDisabled: { opacity: 0.46 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, backgroundColor: 'rgba(24, 40, 31, 0.38)' },
  goalModal: { width: '100%', maxWidth: 390, padding: 20, borderRadius: 24, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4ebe4', shadowColor: '#1b3325', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.16, shadowRadius: 22, elevation: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modalEyebrow: { color: '#839287', fontSize: 8, fontWeight: '700', letterSpacing: 1.15 },
  modalTitle: { color: '#263a2c', fontFamily: 'Georgia', fontSize: 22, lineHeight: 29, marginTop: 3 },
  modalClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f2f5f0' },
  modalHint: { color: '#77847a', fontSize: 11.5, lineHeight: 17, marginTop: 9 },
  goalStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 19, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 19, backgroundColor: '#f6f8f5' },
  stepperButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#e8f0e8' },
  goalValueWrap: { alignItems: 'center' },
  goalValue: { color: '#294433', fontSize: 39, lineHeight: 45, fontWeight: '700', fontVariant: ['tabular-nums'] },
  goalUnit: { color: '#738177', fontSize: 10.5, fontWeight: '600', marginTop: 1 },
  modalFootnote: { color: '#89958c', fontSize: 9.5, lineHeight: 14, marginTop: 11, textAlign: 'center' },
  saveGoalButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, borderRadius: 14, backgroundColor: '#315d50' },
  saveGoalText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
