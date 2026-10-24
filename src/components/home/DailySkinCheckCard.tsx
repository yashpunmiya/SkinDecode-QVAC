import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { DailyRoutineContext, DailySkinCheck, MetricRatings, SkinCheckMetric } from '../../daily-skin-check/rules';
import { compareDailySkinChecks, SKIN_CHECK_METRIC_LABELS, SKIN_CHECK_METRICS } from '../../daily-skin-check/rules';
import { deleteDailySkinPhotoFile, saveDailySkinPhoto, yesterdayDateKey as getYesterdayDateKey, type FaceCropBounds } from '../../daily-skin-check/storage';
import { useDailySkinCheck } from '../../daily-skin-check/useDailySkinCheck';
import { localDateKey } from '../../routine/models';
import { DailySkinFaceScan } from './DailySkinFaceScan';

type Props = {
  userId?: string;
  routineContext: DailyRoutineContext;
};

type CheckDraft = { ratings: Partial<MetricRatings>; photoUri: string | null };
type CheckDate = 'yesterday' | 'today';
type PhotoPreview = { uri: string; label: string; dateKey: string };

const EMPTY_RATINGS: Partial<MetricRatings> = {};

function dateLabel(dateKey: string, format: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, format);
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DailySkinCheckCard({ userId, routineContext }: Props) {
  const tracker = useDailySkinCheck(userId);
  const window = useWindowDimensions();
  const [historyVisible, setHistoryVisible] = useState(false);
  const [comparisonVisible, setComparisonVisible] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<CheckDate | null>(null);
  const [draft, setDraft] = useState<CheckDraft | null>(null);
  const [stagedPhotoUri, setStagedPhotoUri] = useState<string | null>(null);
  const stagedPhotoRef = useRef<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [faceScanVisible, setFaceScanVisible] = useState(false);
  const sheetProgress = useRef(new Animated.Value(0)).current;

  const yesterdayDateKey = useMemo(() => getYesterdayDateKey(new Date(`${tracker.dateKey}T12:00:00`)), [tracker.dateKey]);
  const historyCalendarDays = useMemo(() => {
    const firstDate = new Date(`${tracker.dateKey}T12:00:00`);
    firstDate.setDate(firstDate.getDate() - 29);
    const leadingSlots = firstDate.getDay();
    return [
      ...Array.from({ length: leadingSlots }, () => null),
      ...Array.from({ length: 30 }, (_, index) => {
        const date = new Date(firstDate);
        date.setDate(firstDate.getDate() + index);
        return localDateKey(date);
      }),
    ];
  }, [tracker.dateKey]);
  const historyByDate = useMemo(() => new Map(tracker.history.map((checkin) => [checkin.localDate, checkin])), [tracker.history]);
  const selectedHistoryCheckin = selectedHistoryDate ? historyByDate.get(selectedHistoryDate) ?? null : null;
  const canCompareFaces = Boolean(tracker.yesterday?.photoUri && tracker.today?.photoUri);
  const comparePopupWidth = Math.min(window.width - 40, 390);
  const comparePhotoSide = Math.min(156, (comparePopupWidth - 64) / 2, window.height * 0.27);
  const checkinFor = (day: CheckDate) => day === 'today' ? tracker.today : tracker.yesterday;
  const dateKeyFor = (day: CheckDate) => day === 'today' ? tracker.dateKey : yesterdayDateKey;
  const comparison = useMemo(
    () => compareDailySkinChecks(tracker.yesterday, tracker.today, routineContext),
    [routineContext, tracker.today, tracker.yesterday],
  );
  const formComplete = Boolean((draft?.photoUri || (editingDate && checkinFor(editingDate))) && draft && SKIN_CHECK_METRICS.every((metric) => {
    const value = draft.ratings[metric];
    return typeof value === 'number' && value >= 1 && value <= 5;
  }));

  const setStagedPhoto = (uri: string | null) => {
    stagedPhotoRef.current = uri;
    setStagedPhotoUri(uri);
  };

  const openPhotoPreview = (uri: string | null | undefined, label: string, dateKey: string) => {
    if (!uri) return;
    setPhotoPreview({ uri, label, dateKey });
  };

  const removeDraftPhoto = () => {
    const stagedUri = stagedPhotoRef.current;
    const savedUri = editingDate ? checkinFor(editingDate)?.photoUri : null;
    if (stagedUri && stagedUri !== savedUri) void deleteDailySkinPhotoFile(stagedUri);
    setStagedPhoto(null);
    setDraft((current) => current ? { ...current, photoUri: null } : current);
  };

  useEffect(() => () => {
    if (stagedPhotoRef.current) void deleteDailySkinPhotoFile(stagedPhotoRef.current);
  }, []);

  const openEditor = (day: CheckDate) => {
    setStagedPhoto(null);
    const existing = checkinFor(day);
    setDraft({ ratings: existing ? { ...existing.ratings } : { ...EMPTY_RATINGS }, photoUri: existing?.photoUri || null });
    setEditingDate(day);
    sheetProgress.setValue(0);
    requestAnimationFrame(() => Animated.spring(sheetProgress, {
      toValue: 1,
      speed: 19,
      bounciness: 5,
      useNativeDriver: true,
    }).start());
  };

  const closeEditor = () => {
    Animated.timing(sheetProgress, { toValue: 0, duration: 170, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      if (stagedPhotoRef.current) void deleteDailySkinPhotoFile(stagedPhotoRef.current);
      setStagedPhoto(null);
      setDraft(null);
      setEditingDate(null);
    });
  };

  const captureFacePhoto = async () => {
    if (!draft) return;
    setFaceScanVisible(true);
  };

  const saveScannedFace = async (uri: string, width: number, height: number, face?: FaceCropBounds) => {
    setPhotoLoading(true);
    try {
      const nextUri = await saveDailySkinPhoto(uri, width, height, face);
      if (stagedPhotoUri) await deleteDailySkinPhotoFile(stagedPhotoUri);
      setStagedPhoto(nextUri);
      setDraft((current) => current ? { ...current, photoUri: nextUri } : current);
      setFaceScanVisible(false);
    } catch (error) {
      console.warn('[daily-skin-check] face photo processing failed', error);
      throw error;
    } finally {
      setPhotoLoading(false);
    }
  };

  const saveCheckin = async () => {
    if (!userId || !draft || !formComplete || !editingDate) return;
    const existing = checkinFor(editingDate);
    const isToday = editingDate === 'today';
    const record: DailySkinCheck = {
      userId,
      localDate: dateKeyFor(editingDate),
      ratings: draft.ratings as MetricRatings,
      amRoutineCompleted: isToday ? routineContext.todayAmCompleted : routineContext.yesterdayAmCompleted,
      pmRoutineCompleted: isToday ? routineContext.todayPmCompleted : routineContext.yesterdayPmCompleted,
      newProductStarted: routineContext.newProductStarted,
      photoUri: draft.photoUri,
      updatedAt: new Date().toISOString(),
    };
    try {
      await tracker.save(record);
      if (stagedPhotoUri && stagedPhotoUri !== draft.photoUri) await deleteDailySkinPhotoFile(stagedPhotoUri);
      setStagedPhoto(null);
      closeEditor();
    } catch {
      // Keep the draft open so the user can retry.
    }
  };

  const deleteCheckin = () => {
    if (!editingDate || !checkinFor(editingDate)) return;
    const dateKey = dateKeyFor(editingDate);
    Alert.alert(`Delete ${editingDate}’s skin check?`, 'This removes the ratings and face photo from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        if (stagedPhotoUri && stagedPhotoUri !== checkinFor(editingDate)?.photoUri) void deleteDailySkinPhotoFile(stagedPhotoUri);
        void tracker.removeCheckin(dateKey).then(() => {
          setStagedPhoto(null);
          closeEditor();
        }).catch((error) => {
          console.warn('[daily-skin-check] local delete failed', error);
          Alert.alert('Could not delete', 'Please try again.');
        });
      } },
    ]);
  };

  const openHistory = () => {
    setSelectedHistoryDate(tracker.dateKey);
    setHistoryVisible(true);
    void tracker.refreshHistory();
  };

  const facePhotoSide = Math.max(170, Math.min(250, window.width - 116, window.height * 0.34));

  const status = comparison?.overallStatus;
  const suggestion = comparison?.suggestion
    || (!tracker.yesterday && !tracker.today
      ? 'Capture both days to see how your skin changes.'
      : !tracker.yesterday
        ? 'Add yesterday’s check to start your comparison.'
        : 'Add today’s check to see your skin comparison.');
  const suggestionTitle = comparison?.title && comparison.title !== 'Skin check'
    ? comparison.title
    : 'A little more aware today';
  const sheetTranslateY = sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [34, 0] });
  const sheetScale = sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] });

  return (
    <>
      <View style={styles.section}>
        <View style={styles.cardHeader}>
          <Text style={styles.heading}>Daily skin check</Text>
          <Pressable
            onPress={openHistory}
            accessibilityRole="button"
            accessibilityLabel="View the last 30 days of skin check history"
            style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
          >
            <Feather name="calendar" size={13} color="#527456" />
            <Text style={styles.historyButtonText}>30 days</Text>
          </Pressable>
        </View>

        {tracker.isLoading ? (
          <View style={styles.loadingRow}><ActivityIndicator size="small" color="#3d7055" /><Text style={styles.body}>Loading your local check-ins…</Text></View>
        ) : tracker.error && !tracker.today && !tracker.yesterday ? (
          <Pressable onPress={() => void tracker.refresh()} accessibilityRole="button" style={styles.loadingRow}>
            <Text style={styles.body}>{tracker.error}</Text><Text style={styles.actionLabel}>Retry</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.circlesRow}>
              <DayCircle
                label="Yesterday"
                checkin={tracker.yesterday}
                onEdit={() => openEditor('yesterday')}
              />
              <View style={styles.compareConnector}>
                <Text style={styles.versusLabel}>VS</Text>
                <Pressable
                  onPress={() => setComparisonVisible(true)}
                  disabled={!canCompareFaces}
                  accessibilityRole="button"
                  accessibilityLabel={canCompareFaces ? 'Compare yesterday and today face photos' : 'Add both face photos to compare'}
                  style={({ pressed }) => [styles.compareButton, !canCompareFaces && styles.compareButtonDisabled, pressed && styles.pressed]}
                >
                  <Feather name="columns" size={11} color={canCompareFaces ? '#456b4f' : '#aab3aa'} />
                  <Text style={[styles.compareButtonText, !canCompareFaces && styles.compareButtonTextDisabled]}>Compare</Text>
                </Pressable>
              </View>
              <DayCircle
                label="Today"
                checkin={tracker.today}
                onEdit={() => openEditor('today')}
              />
            </View>

            <View style={styles.suggestionBlock}>
              <View style={[styles.suggestionIcon, status === 'worse' && styles.suggestionIconWorse]}>
                <Feather name={status === 'worse' ? 'heart' : status === 'improved' ? 'trending-down' : 'sun'} size={14} color={status === 'worse' ? '#a46e58' : '#50765a'} />
              </View>
              <View style={styles.suggestionCopy}>
                <View style={styles.suggestionTitleRow}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>{suggestionTitle}</Text>
                  {status ? <View style={[styles.suggestionStatus, status === 'worse' && styles.suggestionStatusWorse]}>
                    <Text style={[styles.suggestionStatusText, status === 'worse' && styles.suggestionStatusTextWorse]}>{statusLabel(status)}</Text>
                  </View> : null}
                </View>
                <Text style={styles.suggestion} numberOfLines={2}>{suggestion}</Text>
              </View>
            </View>
            {tracker.error ? <Text style={styles.errorText}>{tracker.error}</Text> : null}
          </>
        )}
      </View>

      <Modal visible={editingDate !== null} transparent animationType="none" statusBarTranslucent onRequestClose={closeEditor}>
        <Animated.View style={[styles.modalOverlay, { opacity: sheetProgress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEditor} accessibilityRole="button" accessibilityLabel="Close daily skin check" />
          <KeyboardAvoidingView style={styles.sheetWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {editingDate && draft ? (
              <Animated.View style={[styles.sheet, { maxHeight: window.height * 0.94, opacity: sheetProgress, transform: [{ translateY: sheetTranslateY }, { scale: sheetScale }] }]}>
                <View style={styles.sheetHeader}>
                  <View style={styles.sheetIcon}><Feather name="sun" size={15} color="#527456" /></View>
                  <View style={styles.sheetTitleGroup}>
                    <Text style={styles.sheetTitle}>{editingDate === 'today' ? 'Today’s check-in' : 'Yesterday’s check-in'}</Text>
                    <Text style={styles.sheetEyebrow}>{dateLabel(dateKeyFor(editingDate), { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
                  </View>
                  <Pressable onPress={closeEditor} accessibilityRole="button" accessibilityLabel="Close check-in" style={styles.closeButton}><Feather name="x" size={17} color="#526858" /></Pressable>
                </View>
                <View style={styles.formContent}>
                  <View style={draft.photoUri ? styles.photoLayout : styles.photoLayoutEmpty}>
                  <Pressable
                    onPress={() => draft.photoUri ? openPhotoPreview(draft.photoUri, editingDate, dateKeyFor(editingDate)) : void captureFacePhoto()}
                    disabled={photoLoading}
                    accessibilityRole="button"
                    accessibilityLabel={draft.photoUri ? 'Preview face photo' : 'Start face scan'}
                    style={({ pressed }) => [styles.faceImageStage, { width: facePhotoSide, height: facePhotoSide }, draft.photoUri && styles.faceImageStageFilled, pressed && styles.pressed]}
                  >
                    {draft.photoUri ? (
                      <Image source={{ uri: draft.photoUri }} style={styles.facePreview} resizeMode="cover" />
                    ) : (
                      <View style={styles.facePlaceholder}>
                        <View style={styles.faceCameraIcon}><Feather name="camera" size={18} color="#527456" /></View>
                        <Text style={styles.facePlaceholderTitle}>Scan your face</Text>
                        <Text style={styles.facePlaceholderHint}>Tap to start</Text>
                      </View>
                    )}
                  </Pressable>
                  {draft.photoUri ? (
                    <View style={[styles.photoActionsRow, { width: facePhotoSide }]}>
                      <Pressable onPress={() => void captureFacePhoto()} disabled={photoLoading} accessibilityRole="button" accessibilityLabel="Retake face photo" style={({ pressed }) => [styles.photoActionButton, pressed && styles.pressed]}>
                        {photoLoading ? <ActivityIndicator size="small" color="#42694d" /> : <Feather name="refresh-cw" size={13} color="#42694d" />}
                        <Text style={styles.photoActionText}>Retake</Text>
                      </Pressable>
                      <Pressable onPress={removeDraftPhoto} accessibilityRole="button" accessibilityLabel="Remove face photo" style={({ pressed }) => [styles.photoActionButton, styles.removePhotoButton, pressed && styles.pressed]}>
                        <Feather name="trash-2" size={13} color="#9a5a50" />
                        <Text style={[styles.photoActionText, styles.removePhotoText]}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  </View>

                  <View style={styles.signalsHeader}>
                    <Text style={styles.signalsTitle}>Skin signals</Text>
                    <Text style={styles.signalsHint}>Rate each from 1 to 5</Text>
                  </View>
                  {SKIN_CHECK_METRICS.map((metric) => (
                    <RatingRow
                      key={metric}
                      metric={metric}
                      value={draft.ratings[metric]}
                      onChange={(value) => setDraft((current) => current ? { ...current, ratings: { ...current.ratings, [metric]: value } } : current)}
                    />
                  ))}
                  {photoLoading ? <View style={styles.photoLoading}><ActivityIndicator size="small" color="#456e51" /><Text style={styles.formHint}>Preparing face photo…</Text></View> : null}
                </View>
                <View style={styles.sheetFooter}>
                  {checkinFor(editingDate) ? <Pressable onPress={deleteCheckin} accessibilityRole="button" accessibilityLabel="Delete this day’s check-in" style={({ pressed }) => [styles.deleteCheckButton, pressed && styles.pressed]}><Feather name="trash-2" size={13} color="#9a5a50" /><Text style={styles.deleteCheckText}>Delete check-in</Text></Pressable> : null}
                  <View style={styles.saveActionWrap}><PrimaryAction label={tracker.isSaving ? 'Saving…' : `Save ${editingDate} check`} onPress={() => void saveCheckin()} disabled={!formComplete || tracker.isSaving || photoLoading} loading={tracker.isSaving} /></View>
                </View>
              </Animated.View>
            ) : null}
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>

      <Modal visible={historyVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setHistoryVisible(false)}>
        <View style={styles.historyOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setHistoryVisible(false)} accessibilityRole="button" accessibilityLabel="Close skin history" />
          <View style={styles.historySheet}>
            <ScrollView contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
              <View style={styles.historyHeader}>
                <View style={styles.historyTitleGroup}>
                  <Text style={styles.historyEyebrow}>ON THIS DEVICE</Text>
                  <Text style={styles.historyTitle}>Skin history</Text>
                  <Text style={styles.historySubtitle}>Your last 30 days</Text>
                </View>
                <Pressable onPress={() => setHistoryVisible(false)} accessibilityRole="button" accessibilityLabel="Close skin history" style={styles.closeButton}>
                  <Feather name="x" size={17} color="#526858" />
                </Pressable>
              </View>

              <View style={styles.historyWeekdays}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={styles.historyWeekday}>{day}</Text>)}
              </View>
              <View style={styles.historyGrid}>
                {historyCalendarDays.map((dateKey, index) => {
                  if (!dateKey) return <View key={`blank-${index}`} style={styles.historyDayCell} />;
                  const dayNumber = Number(dateKey.slice(-2));
                  const checkin = historyByDate.get(dateKey);
                  const selected = selectedHistoryDate === dateKey;
                  return (
                    <Pressable
                      key={dateKey}
                      onPress={() => setSelectedHistoryDate(dateKey)}
                      accessibilityRole="button"
                      accessibilityLabel={`${dateLabel(dateKey, { weekday: 'long', month: 'long', day: 'numeric' })}${checkin ? ', skin check saved' : ', no skin check'}`}
                      accessibilityState={{ selected }}
                      style={styles.historyDayCell}
                    >
                      <View style={[styles.historyDay, selected && styles.historyDaySelected, !checkin && styles.historyDayEmpty]}>
                        <Text style={[styles.historyDayText, selected && styles.historyDayTextSelected]}>{dayNumber}</Text>
                        {checkin ? <View style={[styles.historyDayMark, selected && styles.historyDayMarkSelected]} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.historyDetail}>
                <View style={styles.historyDetailHeader}>
                  {selectedHistoryCheckin?.photoUri ? (
                    <Pressable onPress={() => openPhotoPreview(selectedHistoryCheckin.photoUri, 'Skin check', selectedHistoryCheckin.localDate)} accessibilityRole="button" accessibilityLabel="View this skin check photo" style={({ pressed }) => [styles.historyDetailIcon, pressed && styles.circlePressed]}>
                      <Image source={{ uri: selectedHistoryCheckin.photoUri }} style={styles.historyDetailPhoto} resizeMode="cover" />
                    </Pressable>
                  ) : (
                    <View style={styles.historyDetailIcon}>
                      <Feather name={selectedHistoryCheckin ? 'check' : 'calendar'} size={15} color="#54745b" />
                    </View>
                  )}
                  <View style={styles.historyDetailCopy}>
                    <Text style={styles.historyDetailDate} numberOfLines={1}>
                      {selectedHistoryDate ? dateLabel(selectedHistoryDate, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Choose a day'}
                    </Text>
                    <Text style={styles.historyDetailStatus}>
                      {tracker.historyLoading ? 'Loading your history…' : selectedHistoryCheckin ? 'Skin check saved' : 'No check-in saved for this day'}
                    </Text>
                  </View>
                </View>
                {selectedHistoryCheckin && !tracker.historyLoading ? (
                  <View style={styles.historyMetrics}>
                    {SKIN_CHECK_METRICS.map((metric) => (
                      <View key={metric} style={styles.historyMetric}>
                        <Text style={styles.historyMetricLabel}>{SKIN_CHECK_METRIC_LABELS[metric]}</Text>
                        <Text style={styles.historyMetricValue}>{selectedHistoryCheckin.ratings[metric]}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={comparisonVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setComparisonVisible(false)}>
        <View style={styles.comparisonOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setComparisonVisible(false)} accessibilityRole="button" accessibilityLabel="Close face comparison" />
          {canCompareFaces ? (
            <View style={styles.comparisonPopup}>
              <View style={styles.comparisonHeader}>
                <View style={styles.comparisonTitleGroup}>
                  <Text style={styles.photoViewerEyebrow}>DAILY SKIN CHECK</Text>
                  <Text style={styles.comparisonTitle}>Face comparison</Text>
                </View>
                <Pressable onPress={() => setComparisonVisible(false)} accessibilityRole="button" accessibilityLabel="Close face comparison" style={styles.closeButton}>
                  <Feather name="x" size={17} color="#526858" />
                </Pressable>
              </View>
              <View style={styles.comparisonImages}>
                <View style={styles.comparisonImageColumn}>
                  <Text style={styles.comparisonDay}>Yesterday</Text>
                  <Image source={{ uri: tracker.yesterday?.photoUri ?? undefined }} style={[styles.comparisonImage, { width: comparePhotoSide, height: comparePhotoSide }]} resizeMode="cover" />
                  <Text style={styles.comparisonDate}>{dateLabel(yesterdayDateKey, { month: 'short', day: 'numeric' })}</Text>
                </View>
                <View style={styles.comparisonDivider}><View style={styles.comparisonDividerLine} /><Text style={styles.comparisonVs}>VS</Text><View style={styles.comparisonDividerLine} /></View>
                <View style={styles.comparisonImageColumn}>
                  <Text style={styles.comparisonDay}>Today</Text>
                  <Image source={{ uri: tracker.today?.photoUri ?? undefined }} style={[styles.comparisonImage, { width: comparePhotoSide, height: comparePhotoSide }]} resizeMode="cover" />
                  <Text style={styles.comparisonDate}>{dateLabel(tracker.dateKey, { month: 'short', day: 'numeric' })}</Text>
                </View>
              </View>
              <Text style={styles.comparisonCaption}>Photos are saved on this device</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={photoPreview !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPhotoPreview(null)}>
        <View style={styles.photoViewerOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPhotoPreview(null)} accessibilityRole="button" accessibilityLabel="Close photo preview" />
          {photoPreview ? (
            <View style={[styles.photoViewer, { maxHeight: window.height * 0.88 }]}>
              <View style={styles.photoViewerHeader}>
                <View style={styles.photoViewerTitleGroup}>
                  <Text style={styles.photoViewerEyebrow}>DAILY SKIN CHECK</Text>
                  <Text style={styles.photoViewerTitle}>{photoPreview.label} · {dateLabel(photoPreview.dateKey)}</Text>
                </View>
                <Pressable onPress={() => setPhotoPreview(null)} accessibilityRole="button" accessibilityLabel="Close photo preview" style={styles.closeButton}>
                  <Feather name="x" size={17} color="#526858" />
                </Pressable>
              </View>
              <View style={[styles.photoViewerImageStage, { height: Math.min(window.height * 0.62, window.width * 1.04) }]}>
                <Image source={{ uri: photoPreview.uri }} style={styles.photoViewerImage} resizeMode="contain" />
              </View>
              <Text style={styles.photoViewerCaption}>Face photo · stored on this device</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      <DailySkinFaceScan
        visible={faceScanVisible}
        onClose={() => setFaceScanVisible(false)}
        onCaptured={saveScannedFace}
      />
    </>
  );
}

function DayCircle({ label, checkin, onEdit }: { label: string; checkin: DailySkinCheck | null; onEdit: () => void }) {
  return (
    <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`${label} skin check, open to edit`} style={({ pressed }) => [styles.dayCircleButton, pressed && styles.circlePressed]}>
      <View style={[styles.dayCircle, checkin?.photoUri ? styles.dayCircleComplete : styles.dayCircleEmpty]}>
        {checkin?.photoUri ? <Image source={{ uri: checkin.photoUri }} style={styles.dayCircleImage} resizeMode="cover" /> : <View style={styles.dayCameraIcon}><Feather name="camera" size={18} color="#66816a" /></View>}
        {checkin?.photoUri ? <View style={styles.dayCircleBadge}><Feather name="check" size={11} color="#fff" /></View> : null}
      </View>
      <Text style={styles.dayCircleLabel}>{label}</Text>
    </Pressable>
  );
}

function RatingRow({ metric, value, onChange }: { metric: SkinCheckMetric; value?: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.ratingRow}>
      <Text style={styles.ratingLabel}>{SKIN_CHECK_METRIC_LABELS[metric]}</Text>
      <View style={styles.ratingScale}>
        {[1, 2, 3, 4, 5].map((score) => (
          <Pressable
            key={score}
            accessibilityRole="button"
            accessibilityLabel={`${SKIN_CHECK_METRIC_LABELS[metric]} ${score} out of 5`}
            accessibilityState={{ selected: value === score }}
            onPress={() => onChange(score)}
            style={[styles.ratingOption, value === score && styles.ratingOptionSelected]}
          ><Text style={[styles.ratingOptionText, value === score && styles.ratingOptionTextSelected]}>{score}</Text></Pressable>
        ))}
      </View>
    </View>
  );
}

function PrimaryAction({ label, onPress, disabled = false, loading = false }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed, disabled && styles.disabled]}>
      {loading ? <ActivityIndicator size="small" color="#fff" /> : null}
      <Text style={styles.primaryActionText}>{label}</Text>
      {!loading ? <Feather name="arrow-right" size={15} color="#fff" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 11,
    borderRadius: 21,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9ebe5',
    shadowColor: '#19352b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 1,
  },
  cardHeader: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 1 },
  heading: { color: '#1f3026', fontSize: 16, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  historyButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 11, backgroundColor: '#f1f5ef' },
  historyButtonText: { color: '#587360', fontSize: 10.5, fontWeight: '700' },
  loadingRow: { minHeight: 106, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  body: { color: '#68786b', fontSize: 12, lineHeight: 18 },
  actionLabel: { color: '#456c50', fontSize: 12, fontWeight: '700' },
  circlesRow: { minHeight: 108, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 2 },
  dayCircleButton: { flex: 1, maxWidth: 112, alignItems: 'center', gap: 2 },
  circlePressed: { opacity: 0.74, transform: [{ scale: 0.97 }] },
  dayCircle: { position: 'relative', width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', overflow: 'visible', borderWidth: 1.5 },
  dayCircleEmpty: { backgroundColor: '#f8faf7', borderColor: '#cfdbcf', borderStyle: 'dashed', borderWidth: 1.5 },
  dayCircleComplete: { backgroundColor: '#fff', borderColor: '#c3d2c1', padding: 3 },
  dayCameraIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#eaf1e8' },
  dayCircleImage: { width: 72, height: 72, borderRadius: 36 },
  dayCircleBadge: { position: 'absolute', right: -1, bottom: 0, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#315d50', borderWidth: 2, borderColor: '#fff' },
  dayCircleLabel: { color: '#293b30', fontSize: 12, fontWeight: '700', marginTop: 3 },
  compareConnector: { width: 78, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 7 },
  versusLabel: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#f5f7f3', color: '#99a49a', fontSize: 7.5, fontWeight: '800', letterSpacing: 0.65 },
  compareButton: { minHeight: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#edf3ea', borderWidth: 1, borderColor: '#e3ebdf' },
  compareButtonDisabled: { backgroundColor: '#f5f6f3', borderColor: '#eef0eb' },
  compareButtonText: { color: '#456b4f', fontSize: 8.5, fontWeight: '700' },
  compareButtonTextDisabled: { color: '#aab3aa' },
  suggestionBlock: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e9ede7' },
  suggestionIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#edf3e9' },
  suggestionIconWorse: { backgroundColor: '#f7eee9' },
  suggestionCopy: { flex: 1, paddingVertical: 1, minWidth: 0 },
  suggestionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
  suggestionTitle: { flex: 1, color: '#293a2f', fontSize: 12, fontWeight: '700' },
  suggestionStatus: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: '#edf3e9' },
  suggestionStatusWorse: { backgroundColor: '#f7eee9' },
  suggestionStatusText: { color: '#55775a', fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },
  suggestionStatusTextWorse: { color: '#a46e58' },
  suggestion: { color: '#68766c', fontSize: 11.5, lineHeight: 15, marginTop: 3 },
  errorText: { color: '#9a5549', fontSize: 10, marginTop: 6 },
  historyOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(26, 39, 29, 0.38)' },
  historySheet: { width: '100%', maxWidth: 390, maxHeight: '86%', borderRadius: 25, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4ebe1', overflow: 'hidden' },
  historyContent: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 18 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 15 },
  historyTitleGroup: { flex: 1 },
  historyEyebrow: { color: '#819181', fontSize: 8, fontWeight: '700', letterSpacing: 1.1 },
  historyTitle: { color: '#263a2c', fontFamily: 'Georgia', fontSize: 22, lineHeight: 27, marginTop: 2 },
  historySubtitle: { color: '#7b887d', fontSize: 10.5, marginTop: 1 },
  historyWeekdays: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  historyWeekday: { width: '14.28%', textAlign: 'center', color: '#94a095', fontSize: 9, fontWeight: '700' },
  historyGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 },
  historyDayCell: { width: '14.2857%', height: 39, alignItems: 'center', justifyContent: 'center' },
  historyDay: { position: 'relative', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  historyDaySelected: { backgroundColor: '#315d48' },
  historyDayEmpty: { backgroundColor: '#f7f8f5' },
  historyDayText: { color: '#3d4d41', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  historyDayTextSelected: { color: '#fff', fontWeight: '700' },
  historyDayMark: { position: 'absolute', bottom: 3, width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: '#698a6d' },
  historyDayMarkSelected: { backgroundColor: '#dce8d9' },
  historyDetail: { marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: '#f6f8f4', borderWidth: 1, borderColor: '#edf0eb' },
  historyDetailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyDetailIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, overflow: 'hidden', backgroundColor: '#e7efe4' },
  historyDetailPhoto: { width: '100%', height: '100%' },
  historyDetailCopy: { flex: 1, minWidth: 0 },
  historyDetailDate: { color: '#304235', fontSize: 12, fontWeight: '700' },
  historyDetailStatus: { color: '#7a887d', fontSize: 10, marginTop: 3 },
  photoViewerOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(22, 32, 25, 0.68)' },
  photoViewer: { width: '100%', maxWidth: 440, padding: 13, borderRadius: 25, backgroundColor: '#f8f9f5', borderWidth: 1, borderColor: 'rgba(255,255,255,0.84)', overflow: 'hidden' },
  photoViewerHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 3, paddingBottom: 8 },
  photoViewerTitleGroup: { flex: 1, minWidth: 0 },
  photoViewerEyebrow: { color: '#829083', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  photoViewerTitle: { color: '#293d30', fontSize: 13, fontWeight: '700', marginTop: 2 },
  photoViewerImageStage: { width: '100%', maxHeight: 690, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 17, backgroundColor: '#e9ede6' },
  photoViewerImage: { width: '100%', height: '100%' },
  photoViewerCaption: { color: '#78877b', fontSize: 9.5, paddingTop: 9, paddingLeft: 2 },
  comparisonOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(22, 32, 25, 0.58)' },
  comparisonPopup: { width: '100%', maxWidth: 390, padding: 15, borderRadius: 25, backgroundColor: '#fafbf8', borderWidth: 1, borderColor: 'rgba(255,255,255,0.88)', shadowColor: '#17291d', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 18 },
  comparisonHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  comparisonTitleGroup: { flex: 1 },
  comparisonTitle: { color: '#293d30', fontFamily: 'Georgia', fontSize: 18, marginTop: 2 },
  comparisonImages: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  comparisonImageColumn: { flex: 1, alignItems: 'center', gap: 6 },
  comparisonDay: { color: '#3e5945', fontSize: 11, fontWeight: '700' },
  comparisonImage: { maxWidth: '100%', borderRadius: 16, backgroundColor: '#e8eee5', borderWidth: 1, borderColor: '#e3e9df' },
  comparisonDate: { color: '#859185', fontSize: 9, fontWeight: '600' },
  comparisonDivider: { width: 18, alignItems: 'center', justifyContent: 'center', gap: 5 },
  comparisonDividerLine: { width: 1, height: 22, backgroundColor: '#dfe6dc' },
  comparisonVs: { color: '#9aa69a', fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
  comparisonCaption: { color: '#8a968b', fontSize: 9, textAlign: 'center', marginTop: 13 },
  historyMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  historyMetric: { minWidth: 62, flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: '#fff' },
  historyMetricLabel: { color: '#758277', fontSize: 8.5, fontWeight: '600' },
  historyMetricValue: { color: '#365541', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14, backgroundColor: 'rgba(26, 39, 29, 0.5)' },
  sheetWrap: { width: '100%', flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  sheet: { width: '100%', maxWidth: 440, paddingTop: 10, borderRadius: 26, backgroundColor: '#fff', overflow: 'hidden', borderWidth: 1, borderColor: '#e6ece3', shadowColor: '#17291d', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 18 },
  sheetHeader: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#edf0eb' },
  sheetIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#eff5ed' },
  sheetTitleGroup: { flex: 1 },
  sheetEyebrow: { color: '#849285', fontSize: 9, fontWeight: '500', marginTop: 1 },
  sheetTitle: { color: '#25382c', fontFamily: 'Georgia', fontSize: 16, lineHeight: 20 },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f2f5f0' },
  formContent: { paddingHorizontal: 16, paddingTop: 9, paddingBottom: 8 },
  photoLayout: { width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoLayoutEmpty: { alignItems: 'center', justifyContent: 'center' },
  faceImageStage: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 21, backgroundColor: '#eef2eb' },
  faceImageStageFilled: { backgroundColor: '#e5e9e2' },
  facePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 7 },
  faceCameraIcon: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e1ebdd' },
  facePlaceholderTitle: { color: '#38523e', fontSize: 12, fontWeight: '700' },
  facePlaceholderHint: { color: '#819083', fontSize: 9.5 },
  facePreview: { width: '100%', height: '100%' },
  photoActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  photoActionButton: { minHeight: 36, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: '#edf2eb' },
  photoActionText: { color: '#42694d', fontSize: 9.5, fontWeight: '700' },
  removePhotoButton: { backgroundColor: '#f8efec' },
  removePhotoText: { color: '#9a5a50' },
  signalsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8, marginBottom: 1, paddingHorizontal: 2 },
  signalsTitle: { color: '#2d4033', fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  signalsHint: { color: '#879288', fontSize: 8.5 },
  ratingRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#edf0eb' },
  ratingLabel: { color: '#35473a', fontSize: 12.5, fontWeight: '600' },
  ratingScale: { flexDirection: 'row', gap: 6 },
  ratingOption: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#f4f6f2', borderWidth: 1, borderColor: '#e9eee7' },
  ratingOptionSelected: { backgroundColor: '#315d48', borderColor: '#315d48' },
  ratingOptionText: { color: '#758176', fontSize: 11, fontWeight: '600' },
  ratingOptionTextSelected: { color: '#fff' },
  photoLoading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  formHint: { color: '#879289', fontSize: 10.5, marginVertical: 4 },
  sheetFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 7, paddingBottom: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#edf0eb', backgroundColor: '#fff' },
  saveActionWrap: { flex: 1 },
  primaryAction: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 13, borderRadius: 13, backgroundColor: '#315d48' },
  primaryActionText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  deleteCheckButton: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#faefed' },
  deleteCheckText: { color: '#9a5a50', fontSize: 9, fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.48 },
});
