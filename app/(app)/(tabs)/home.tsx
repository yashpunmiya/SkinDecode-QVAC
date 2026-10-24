import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { RoutinePreviewCard } from '../../../src/components/home/RoutinePreviewCard';
import { DailySkinCheckCard } from '../../../src/components/home/DailySkinCheckCard';
import { buildDailyRoutineContext } from '../../../src/daily-skin-check/routine-context';
import { useRoutine } from '../../../src/routine/RoutineProvider';
import { localDateKey } from '../../../src/routine/models';
import { fetchUvWeather, uvPresentation, weatherCondition, type UvWeather } from '../../../src/weather/uv-weather';
import { WaterIntakeCard } from '../../../src/components/water/WaterIntakeCard';

function startOfWeek(date: Date) {
  const start = new Date(date);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

function sameDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWish(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return 'A lovely morning';
  if (hour < 17) return 'A gentle afternoon';
  return 'A peaceful evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { snapshot, stepsForPeriod, status: routineStatus } = useRoutine();
  const metadata = session?.user.user_metadata ?? {};
  const fullName = String(metadata.full_name || metadata.name || metadata.given_name || 'there').trim();
  const firstName = fullName.split(/\s+/)[0] || 'there';
  const today = useMemo(() => new Date(), []);
  const [selectedDay, setSelectedDay] = useState(() => new Date(today));
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(today));
  const [activePopup, setActivePopup] = useState<'calendar' | 'uv' | null>(null);
  const [uvWeather, setUvWeather] = useState<UvWeather | null>(null);
  const [uvLocationLabel, setUvLocationLabel] = useState('Your current location');
  const [uvLoading, setUvLoading] = useState(false);
  const [uvError, setUvError] = useState<string | null>(null);
  const [uvPermissionDenied, setUvPermissionDenied] = useState(false);
  const [uvCanAskAgain, setUvCanAskAgain] = useState(true);
  const uvRequestInFlight = useRef(false);
  const weekDays = useMemo(() => {
    const first = startOfWeek(selectedDay);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }, [selectedDay]);
  const calendarDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(calendarMonth));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [calendarMonth]);
  const loggedDays = useMemo(() => new Set(snapshot.logs.filter((log) => !log.deletedAt && log.status === 'completed').map((log) => log.logDate)), [snapshot.logs]);
  const dayAnimations = useRef(weekDays.map((date) => new Animated.Value(sameDay(date, today) ? 1 : 0))).current;
  const popupProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    dayAnimations.forEach((animation, index) => {
      Animated.spring(animation, {
        toValue: sameDay(weekDays[index]!, selectedDay) ? 1 : 0,
        speed: 22,
        bounciness: 3,
        useNativeDriver: true,
      }).start();
    });
  }, [dayAnimations, selectedDay, weekDays]);

  const loadUvWeather = async () => {
    if (uvRequestInFlight.current) return;
    uvRequestInFlight.current = true;
    setUvLoading(true);
    setUvError(null);
    setUvPermissionDenied(false);
    try {
      // Load the native module only when the user opens UV. This keeps the
      // Home route usable in an older development build while it is being rebuilt.
      const Location = await import('expo-location');
      const existingPermission = await Location.getForegroundPermissionsAsync();
      const permission = existingPermission.granted ? existingPermission : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setUvPermissionDenied(true);
        setUvCanAskAgain(permission.canAskAgain);
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const [addresses, weather] = await Promise.all([
        Location.reverseGeocodeAsync(coordinates).catch(() => []),
        fetchUvWeather(coordinates.latitude, coordinates.longitude),
      ]);
      const [address] = addresses;
      const city = address?.city || address?.district || address?.subregion || address?.region;
      const region = address?.country;
      setUvWeather(weather);
      setUvLocationLabel([city, region].filter(Boolean).join(', ') || 'Your current location');
    } catch (error) {
      console.warn('[uv-weather] unable to load local conditions', error);
      const message = error instanceof Error ? error.message : String(error);
      setUvError(/ExpoLocation|native module/i.test(message)
        ? 'Update the SkinDecode app build to enable location, then try again.'
        : 'We could not get the local UV and weather right now. Check your connection and try again.');
    } finally {
      uvRequestInFlight.current = false;
      setUvLoading(false);
    }
  };

  const presentPopup = (popup: 'calendar' | 'uv') => {
    if (popup === 'calendar') setCalendarMonth(startOfMonth(selectedDay));
    popupProgress.setValue(0);
    setActivePopup(popup);
    if (popup === 'uv') void loadUvWeather();
    requestAnimationFrame(() => Animated.spring(popupProgress, {
      toValue: 1,
      speed: 20,
      bounciness: 4,
      useNativeDriver: true,
    }).start());
  };

  const dismissPopup = () => {
    Animated.timing(popupProgress, { toValue: 0, duration: 140, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setActivePopup(null);
    });
  };

  const selectCalendarDay = (date: Date) => {
    setSelectedDay(date);
    dismissPopup();
  };

  const avatarUrl = metadata.avatar_url || metadata.picture;
  const amSteps = stepsForPeriod('am').filter((step) => step.daysOfWeek.includes(selectedDay.getDay()));
  const pmSteps = stepsForPeriod('pm').filter((step) => step.daysOfWeek.includes(selectedDay.getDay()));
  const routineContext = buildDailyRoutineContext(snapshot);
  const uvAppearance = uvWeather ? uvPresentation(uvWeather.uvIndex) : null;
  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.weekPanel}>
            <View style={styles.header}>
              <View style={styles.identity}>
                {avatarUrl ? (
                  <Animated.Image source={{ uri: String(avatarUrl) }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.greeting}>
                  <Text style={styles.hello} numberOfLines={1}>Hello, {firstName}</Text>
                  <Text style={styles.wish}>{formatWish(today)}</Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open calendar"
                  accessibilityHint="Choose a day to view its routine progress"
                  onPress={() => presentPopup('calendar')}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                >
                  <Feather name="calendar" size={18} color="#34443a" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={uvWeather ? `UV index ${uvWeather.uvIndex.toFixed(1)}, ${uvAppearance?.label}. Open local UV and weather.` : 'Open local UV and weather'}
                  accessibilityHint="Shows local UV index, temperature and sun protection guidance"
                  onPress={() => presentPopup('uv')}
                  style={({ pressed }) => [styles.uvAction, uvAppearance && { backgroundColor: uvAppearance.tint, borderColor: `${uvAppearance.color}33` }, pressed && styles.pressed]}
                >
                  <Feather name="sun" size={17} color={uvAppearance?.color || '#526d56'} />
                  <Text style={[styles.uvActionLabel, uvAppearance && { color: uvAppearance.color }]}>{uvWeather ? `UV ${Number(uvWeather.uvIndex.toFixed(1))}` : 'UV'}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.weekRow}>
              {weekDays.map((date, index) => {
                const isSelected = sameDay(date, selectedDay);
                const isToday = sameDay(date, today);
                const hasActivity = loggedDays.has(localDateKey(date));
                const animation = dayAnimations[index]!;
                const activeStyle = {
                  opacity: animation,
                  transform: [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }],
                };
                return (
                  <Pressable
                    key={date.toISOString()}
                    accessibilityRole="button"
                    accessibilityLabel={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelectedDay(date)}
                    style={styles.dayButton}
                  >
                    <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                    <View style={[styles.dayNumberCircle, isToday && !isSelected && styles.dayNumberCircleToday]}>
                      <Animated.View style={[styles.daySelectedCircle, activeStyle]} />
                      <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>{date.getDate()}</Text>
                    </View>
                    <View style={styles.dayMarker}>{hasActivity ? <View style={[styles.dayActivityDot, isSelected && styles.dayActivityDotSelected]} /> : null}</View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.mainContent}>
            <WaterIntakeCard userId={session?.user.id} />
            <RoutinePreviewCard
              userId={session?.user.id}
              amSteps={amSteps}
              pmSteps={pmSteps}
              loading={routineStatus === 'loading'}
              unavailable={routineStatus === 'error'}
              onPress={() => router.push('/routine' as Href)}
            />
            <DailySkinCheckCard
              key={session?.user.id || 'signed-out'}
              userId={session?.user.id}
              routineContext={routineContext}
            />
          </View>
        </ScrollView>
        <Modal visible={activePopup !== null} transparent animationType="none" onRequestClose={dismissPopup} statusBarTranslucent>
          <View style={styles.popupOverlay}>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.popupScrim, { opacity: popupProgress }]} />
            <Pressable style={StyleSheet.absoluteFill} onPress={dismissPopup} accessibilityRole="button" accessibilityLabel="Close popup" />
            <Animated.View style={[styles.popupCard, {
              opacity: popupProgress,
              transform: [
                { translateY: popupProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
                { scale: popupProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
              ],
            }]}>
              {activePopup === 'calendar' ? <>
                <View style={styles.popupHeader}>
                  <View><Text style={styles.popupEyebrow}>YOUR SKIN JOURNAL</Text><Text style={styles.popupTitle}>Calendar</Text></View>
                  <Pressable onPress={dismissPopup} accessibilityRole="button" accessibilityLabel="Close calendar" style={styles.popupClose}><Feather name="x" size={18} color="#526858" /></Pressable>
                </View>
                <View style={styles.monthNavigation}>
                  <Pressable onPress={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.monthArrow}><Feather name="chevron-left" size={18} color="#47634d" /></Pressable>
                  <Text style={styles.monthLabel}>{calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
                  <Pressable onPress={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} accessibilityRole="button" accessibilityLabel="Next month" style={styles.monthArrow}><Feather name="chevron-right" size={18} color="#47634d" /></Pressable>
                </View>
                <View style={styles.calendarWeekdays}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => <Text key={`${weekday}-${index}`} style={styles.calendarWeekday}>{weekday}</Text>)}</View>
                <View style={styles.calendarGrid}>
                  {calendarDays.map((date) => {
                    const isSelected = sameDay(date, selectedDay);
                    const isToday = sameDay(date, today);
                    const inCurrentMonth = date.getMonth() === calendarMonth.getMonth();
                    const hasActivity = loggedDays.has(localDateKey(date));
                    return <Pressable key={localDateKey(date)} onPress={() => selectCalendarDay(date)} accessibilityRole="button" accessibilityLabel={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} accessibilityState={{ selected: isSelected }} style={styles.calendarCell}>
                      <View style={[styles.calendarDateCircle, isSelected && styles.calendarDateSelected, isToday && !isSelected && styles.calendarDateToday]}><Text style={[styles.calendarDateText, !inCurrentMonth && styles.calendarDateMuted, isSelected && styles.calendarDateTextSelected]}>{date.getDate()}</Text></View>
                      <View style={styles.calendarActivitySlot}>{hasActivity ? <View style={[styles.calendarActivityDot, isSelected && styles.calendarActivityDotSelected]} /> : null}</View>
                    </Pressable>;
                  })}
                </View>
                <View style={styles.calendarFooter}>
                  <View style={styles.calendarLegend}><View style={styles.calendarActivityDot} /><Text style={styles.calendarLegendText}>Routine completed</Text></View>
                  <Pressable onPress={() => selectCalendarDay(new Date(today))} accessibilityRole="button" style={styles.todayButton}><Text style={styles.todayButtonText}>Today</Text></Pressable>
                </View>
              </> : activePopup === 'uv' ? <>
                <View style={styles.popupHeader}>
                  <View><Text style={styles.popupEyebrow}>LOCAL CONDITIONS</Text><Text style={styles.popupTitle}>UV & weather</Text></View>
                  <Pressable onPress={dismissPopup} accessibilityRole="button" accessibilityLabel="Close UV and weather" style={styles.popupClose}><Feather name="x" size={18} color="#526858" /></Pressable>
                </View>
                <ScrollView style={styles.uvScroll} contentContainerStyle={styles.uvScrollContent} showsVerticalScrollIndicator={false}>
                {uvPermissionDenied ? (
                  <View style={styles.uvState}>
                    <View style={styles.uvStateIcon}><Feather name="map-pin" size={20} color="#55735b" /></View>
                    <Text style={styles.uvStateTitle}>Your local UV, at a glance</Text>
                    <Text style={styles.uvStateBody}>Allow location while SkinDecode is open to find nearby UV and weather. Your precise coordinates are rounded before the weather request and are not saved.</Text>
                    <Pressable onPress={() => uvCanAskAgain ? void loadUvWeather() : void Linking.openSettings()} accessibilityRole="button" style={styles.uvPrimaryAction}>
                      <Text style={styles.uvPrimaryActionText}>{uvCanAskAgain ? 'Allow location' : 'Open settings'}</Text>
                      <Feather name={uvCanAskAgain ? 'arrow-right' : 'external-link'} size={15} color="#fff" />
                    </Pressable>
                  </View>
                ) : uvWeather ? (
                  <View style={styles.uvContent}>
                    <View style={styles.uvLocationRow}>
                      <View style={styles.uvLocationCopy}>
                        <Feather name="map-pin" size={12} color="#728276" />
                        <Text style={styles.uvLocation} numberOfLines={1}>{uvLocationLabel}</Text>
                      </View>
                      <Text style={styles.uvUpdated}>{uvWeather.observedAt.includes('T') ? uvWeather.observedAt.slice(11, 16) : ''}</Text>
                    </View>
                    <View style={[styles.uvHero, { backgroundColor: uvAppearance?.tint || '#edf5eb' }]}>
                      <View style={[styles.uvIndexOrb, { borderColor: uvAppearance?.color || '#477653' }]}>
                        <Feather name="sun" size={18} color={uvAppearance?.color || '#477653'} />
                        <Text style={[styles.uvIndexNumber, { color: uvAppearance?.color || '#477653' }]}>{Number(uvWeather.uvIndex.toFixed(1))}</Text>
                      </View>
                      <View style={styles.uvHeroCopy}>
                        <Text style={styles.uvHeroEyebrow}>CURRENT UV INDEX</Text>
                        <Text style={[styles.uvLevel, { color: uvAppearance?.color || '#477653' }]}>{uvAppearance?.label}</Text>
                        <Text style={styles.uvSpf}>{uvAppearance?.spf} suggested</Text>
                      </View>
                    </View>
                    <Text style={styles.uvAdvice}>{uvAppearance?.advice}</Text>
                    <View style={styles.weatherGrid}>
                      <View style={styles.weatherMetric}>
                        <Feather name="thermometer" size={14} color="#9a7251" />
                        <Text style={styles.weatherMetricValue}>{Math.round(uvWeather.temperatureC)}°C</Text>
                        <Text style={styles.weatherMetricLabel}>{weatherCondition(uvWeather.weatherCode)}</Text>
                      </View>
                      <View style={styles.weatherMetric}>
                        <Feather name="wind" size={14} color="#70838a" />
                        <Text style={styles.weatherMetricValue}>{Math.round(uvWeather.feelsLikeC)}°C</Text>
                        <Text style={styles.weatherMetricLabel}>Feels like</Text>
                      </View>
                      <View style={styles.weatherMetric}>
                        <Feather name="droplet" size={14} color="#60889b" />
                        <Text style={styles.weatherMetricValue}>{Math.round(uvWeather.humidity)}%</Text>
                        <Text style={styles.weatherMetricLabel}>Humidity</Text>
                      </View>
                      <View style={styles.weatherMetric}>
                        <Feather name="wind" size={14} color="#78858c" />
                        <Text style={styles.weatherMetricValue}>{Math.round(uvWeather.windSpeedKmh)} km/h</Text>
                        <Text style={styles.weatherMetricLabel}>Wind</Text>
                      </View>
                    </View>
                    {uvError ? <Text style={styles.uvRefreshError}>{uvError}</Text> : null}
                    <Pressable onPress={() => void loadUvWeather()} accessibilityRole="button" accessibilityLabel="Refresh local UV and weather" style={styles.uvRefresh}>
                      {uvLoading ? <ActivityIndicator size="small" color="#48634d" /> : <Feather name="refresh-cw" size={14} color="#48634d" />}
                      <Text style={styles.uvRefreshText}>{uvLoading ? 'Updating conditions…' : 'Refresh conditions'}</Text>
                    </Pressable>
                    <Text style={styles.uvSafetyNote}>Sun protection is generally recommended from UV 3 and above. Shade and protective clothing help too.</Text>
                    <Pressable onPress={() => void Linking.openURL('https://open-meteo.com')} accessibilityRole="link" style={styles.weatherAttribution}>
                      <Text style={styles.weatherAttributionText}>Weather data by Open-Meteo</Text>
                      <Feather name="external-link" size={11} color="#829083" />
                    </Pressable>
                  </View>
                ) : uvLoading ? (
                  <View style={styles.uvState}>
                    <View style={styles.uvLoadingIcon}><ActivityIndicator size="small" color="#55735b" /></View>
                    <Text style={styles.uvStateTitle}>Finding your local conditions</Text>
                    <Text style={styles.uvStateBody}>Getting a nearby UV reading and current weather…</Text>
                  </View>
                ) : (
                  <View style={styles.uvState}>
                    <View style={styles.uvStateIcon}><Feather name="cloud-off" size={20} color="#55735b" /></View>
                    <Text style={styles.uvStateTitle}>UV is temporarily unavailable</Text>
                    <Text style={styles.uvStateBody}>{uvError || 'We could not get the local UV and weather right now.'}</Text>
                    <Pressable onPress={() => void loadUvWeather()} accessibilityRole="button" style={styles.uvPrimaryAction}>
                      <Text style={styles.uvPrimaryActionText}>Try again</Text>
                      <Feather name="rotate-cw" size={15} color="#fff" />
                    </Pressable>
                  </View>
                )}
                </ScrollView>
              </> : null}
            </Animated.View>
          </View>
        </Modal>
      </SafeAreaView>
    </TabScreenTransition>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f2' },
  content: { flexGrow: 1, paddingBottom: 116, backgroundColor: '#f5f5f2' },
  weekPanel: {
    zIndex: 1,
    backgroundColor: '#f5f5f2',
    paddingHorizontal: 21,
    paddingBottom: 9,
  },
  header: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#f2f5f0',
    backgroundColor: '#e9eee7',
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#34563e', fontSize: 17, fontWeight: '700' },
  greeting: { flex: 1, minWidth: 0 },
  hello: { color: '#1c2d23', fontSize: 18.5, lineHeight: 23, fontWeight: '700', letterSpacing: -0.4 },
  wish: { marginTop: 1, color: '#78837b', fontSize: 12, fontWeight: '500' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f8f5',
    borderWidth: 1,
    borderColor: '#eeefe9',
  },
  uvAction: { minWidth: 76, height: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 19, backgroundColor: '#eff4ed', borderWidth: 1, borderColor: '#e1e9de' },
  uvActionLabel: { color: '#526d56', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 5, paddingBottom: 1 },
  dayButton: { flex: 1, minWidth: 0, height: 65, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dayName: { color: '#89938a', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  dayNameSelected: { color: '#31543b', fontWeight: '700' },
  dayNumberCircle: { position: 'relative', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  dayNumberCircleToday: { borderWidth: 1, borderColor: '#a9bba9', borderRadius: 17 },
  daySelectedCircle: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 17, backgroundColor: '#31543b' },
  dayNumber: { color: '#314438', fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
  dayNumberSelected: { color: '#fff', fontWeight: '700' },
  dayMarker: { width: 5, height: 5, alignItems: 'center', justifyContent: 'center' },
  dayActivityDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#8da28d' },
  dayActivityDotSelected: { backgroundColor: '#547759' },
  mainContent: { position: 'relative', zIndex: 2, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  popupOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  popupScrim: { backgroundColor: 'rgba(22, 38, 27, 0.42)' },
  popupCard: { width: '100%', maxWidth: 390, maxHeight: '88%', padding: 19, borderRadius: 25, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4ebe1', shadowColor: '#1c3324', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 15 },
  popupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  popupEyebrow: { color: '#819181', fontSize: 8, fontWeight: '700', letterSpacing: 1.2 },
  popupTitle: { color: '#263a2c', fontFamily: 'Georgia', fontSize: 23, lineHeight: 29, marginTop: 3 },
  popupClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f2f5f0' },
  monthNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 17, marginBottom: 8 },
  monthArrow: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f4f6f2' },
  monthLabel: { color: '#314536', fontSize: 13, fontWeight: '700' },
  calendarWeekdays: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  calendarWeekday: { width: '13.5%', textAlign: 'center', color: '#879287', fontSize: 9, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  calendarCell: { width: '13.5%', height: 39, alignItems: 'center', justifyContent: 'center' },
  calendarDateCircle: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  calendarDateSelected: { backgroundColor: '#31543b' },
  calendarDateToday: { borderWidth: 1, borderColor: '#bccdba' },
  calendarDateText: { color: '#35463a', fontSize: 11, fontWeight: '500' },
  calendarDateTextSelected: { color: '#fff', fontWeight: '700' },
  calendarDateMuted: { color: '#bdc5bc' },
  calendarActivitySlot: { position: 'absolute', bottom: 0, width: 5, height: 5, alignItems: 'center', justifyContent: 'center' },
  calendarActivityDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#91a491' },
  calendarActivityDotSelected: { backgroundColor: '#dce8da' },
  calendarFooter: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8ede6' },
  calendarLegend: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calendarLegendText: { color: '#7c897e', fontSize: 9.5 },
  todayButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#edf4eb' },
  todayButtonText: { color: '#43634a', fontSize: 10, fontWeight: '700' },
  uvScroll: { flexGrow: 0, marginTop: 12 },
  uvScrollContent: { paddingBottom: 4 },
  uvContent: { paddingBottom: 3 },
  uvLocationRow: { minHeight: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  uvLocationCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  uvLocation: { flex: 1, color: '#6f7e72', fontSize: 11, fontWeight: '600' },
  uvUpdated: { color: '#8a948b', fontSize: 10, fontVariant: ['tabular-nums'] },
  uvHero: { minHeight: 118, flexDirection: 'row', alignItems: 'center', gap: 15, marginTop: 10, padding: 15, borderRadius: 20 },
  uvIndexOrb: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center', borderRadius: 41, backgroundColor: '#fff', borderWidth: 2 },
  uvIndexNumber: { fontSize: 27, lineHeight: 31, fontWeight: '700', fontVariant: ['tabular-nums'] },
  uvHeroCopy: { flex: 1 },
  uvHeroEyebrow: { color: '#69786d', fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  uvLevel: { fontSize: 19, lineHeight: 24, fontWeight: '700', marginTop: 3 },
  uvSpf: { color: '#526056', fontSize: 12, fontWeight: '600', marginTop: 4 },
  uvAdvice: { color: '#67746b', fontSize: 11, lineHeight: 16, marginTop: 10 },
  weatherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  weatherMetric: { width: '48%', minHeight: 79, flexGrow: 1, padding: 11, borderRadius: 15, backgroundColor: '#f7f8f5', borderWidth: 1, borderColor: '#edf0eb' },
  weatherMetricValue: { color: '#2c3d31', fontSize: 16, lineHeight: 20, fontWeight: '700', marginTop: 3 },
  weatherMetricLabel: { color: '#78847b', fontSize: 10, lineHeight: 14, marginTop: 1 },
  uvRefreshError: { color: '#9a5549', fontSize: 10.5, lineHeight: 15, marginTop: 11 },
  uvRefresh: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 13, backgroundColor: '#edf3eb' },
  uvRefreshText: { color: '#48634d', fontSize: 11.5, fontWeight: '700' },
  uvSafetyNote: { color: '#89938a', fontSize: 10, lineHeight: 15, marginTop: 12, textAlign: 'center' },
  weatherAttribution: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 },
  weatherAttributionText: { color: '#829083', fontSize: 9.5, fontWeight: '600', textDecorationLine: 'underline' },
  uvState: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 7 },
  uvStateIcon: { width: 47, height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#edf3eb' },
  uvLoadingIcon: { width: 47, height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#edf3eb' },
  uvStateTitle: { color: '#2b3e30', fontSize: 15, fontWeight: '700', marginTop: 13, textAlign: 'center' },
  uvStateBody: { color: '#77847a', fontSize: 11.5, lineHeight: 17, textAlign: 'center', maxWidth: 285, marginTop: 6 },
  uvPrimaryAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', marginTop: 15, paddingHorizontal: 13, borderRadius: 14, backgroundColor: '#31543b' },
  uvPrimaryActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
