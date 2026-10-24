import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { RoutineBottle } from '../../../src/components/routine/RoutineBottle';
import { useDailySkinCheck } from '../../../src/daily-skin-check/useDailySkinCheck';
import { compareDailySkinChecks, type DailySkinCheck } from '../../../src/daily-skin-check/rules';
import { getSkinProfile, getProductDetail, getRoutineProductSummaries, listShelfItems, searchProducts } from '../../../src/products/catalog-service';
import { getCachedProduct, getCachedProductsByIds, getCachedShelfItems } from '../../../src/products/product-cache';
import { scoreProductMatch } from '../../../src/products/product-intelligence';
import type { ProductSummary, SkinProfile } from '../../../src/products/types';
import { useRoutine } from '../../../src/routine/RoutineProvider';
import { localDateKey } from '../../../src/routine/models';
import type { UserProfileRow } from '../../../src/types/database.types';
import { AIChatService } from '../../../src/skin-ai/chat-service';
import type { SkinAIContextAttachment, SkinAIContextType, SkinAIMessage } from '../../../src/skin-ai/types';
import { cacheSkinAIContext, getCachedSkinAIContext, loadSkinAIHistory, saveSkinAIMessage } from '../../../src/skin-ai/storage';

const QUICK_QUESTIONS = [
  'Explain this product for my skin',
  'Can I use these products together?',
  'What should I do tonight?',
  'Why does my skin feel worse today?',
  'Build a routine from my shelf',
];
const CONTEXT_CHOICES: Array<{ type: SkinAIContextType; label: string; icon: React.ComponentProps<typeof Feather>['name']; hint: string }> = [
  { type: 'product', label: 'Choose Product', icon: 'search', hint: 'Pick from the catalog' },
  { type: 'skin-profile', label: 'My Skin', icon: 'user', hint: 'Skin type, sensitivity, concerns and goals' },
  { type: 'skin-check', label: 'Today vs Yesterday', icon: 'activity', hint: 'Recent local check-in and comparison' },
  { type: 'routine', label: 'My Routine', icon: 'sun', hint: 'Current AM/PM steps and today’s completion' },
  { type: 'shelf', label: 'My Shelf', icon: 'briefcase', hint: 'Products saved to your shelf' },
];

function newId() { return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function profileFromRow(row: UserProfileRow): SkinProfile {
  return { ageRange: row.age_range, skinType: row.skin_type, sensitivity: row.sensitivity,
    concerns: row.skin_concerns || [], goals: row.skin_goals || [], preferences: row.preferences || [] };
}
function readable(value: unknown) { return typeof value === 'string' ? value.replaceAll('_', ' ') : ''; }
function makeAttachment(type: SkinAIContextType, label: string, summary: string, data: Record<string, unknown> = {}, sourceId?: string | number): SkinAIContextAttachment {
  return { id: `${type}:${String(sourceId ?? 'current')}`, type, label, summary, ...(sourceId !== undefined ? { sourceId } : {}), selectedByUser: true, data };
}
function progressPhotoAttachment(label: string, check: DailySkinCheck): SkinAIContextAttachment {
  return { id: `progress-photo:${check.localDate}`, type: 'progress-photo', sourceId: check.localDate, label: `${label} skin photo`, summary: `Locally saved ${label.toLowerCase()} skin check photo from ${check.localDate}`, selectedByUser: true, localPhotoUri: check.photoUri ?? undefined };
}

export default function SkinAIScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contextType?: string; contextId?: string; contextLabel?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { snapshot: routineSnapshot } = useRoutine();
  const skinCheck = useDailySkinCheck(userId);
  const [messages, setMessages] = useState<SkinAIMessage[]>([]);
  const [attachments, setAttachments] = useState<SkinAIContextAttachment[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooserVisible, setChooserVisible] = useState(false);
  const [pickerOpenCount, setPickerOpenCount] = useState(0);
  const [pickerPreviews, setPickerPreviews] = useState<Partial<Record<SkinAIContextType, SkinAIContextAttachment>>>({});
  const [selectingProduct, setSelectingProduct] = useState(false);
  const [busyContext, setBusyContext] = useState<SkinAIContextType | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductSummary[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const productSearchInputRef = useRef<TextInput>(null);
  const requestRef = useRef<AbortController | null>(null);
  const historyOwner = useRef<string | undefined>(undefined);
  const routinePreviewKeyRef = useRef('');
  const enter = useRef(new Animated.Value(0)).current;
  const contextProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 460, useNativeDriver: true }).start();
  }, [enter]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    if (!chooserVisible || !selectingProduct) return;
    const frame = requestAnimationFrame(() => productSearchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [chooserVisible, selectingProduct]);

  useEffect(() => {
    if (!chooserVisible || !userId) return;
    let active = true;
    const previews: Partial<Record<SkinAIContextType, SkinAIContextAttachment>> = {};
    const routine = routineSnapshot.routines.find((item) => item.isActive) || routineSnapshot.routines[0];
    const routineSteps = routineSnapshot.steps.filter((step) => step.routineId === routine?.id && step.enabled).sort((a, b) => a.position - b.position);
    const routinePreviewKey = `${userId}:${routine?.id || 'none'}:${routineSteps.map((step) => `${step.id}:${step.productId ?? ''}:${step.shelfItemId ?? ''}`).join('|')}`;
    const routineRows = routineSteps.map((step) => ({ id: step.id, name: step.title, period: step.period, productId: step.productId, shelfItemId: step.shelfItemId, todayStatus: routineSnapshot.logs.find((log) => log.stepId === step.id && log.logDate === localDateKey() && !log.deletedAt)?.status || 'pending' }));
    previews.routine = makeAttachment('routine', 'My Routine', routineSummary(routineRows), { steps: routineRows }, routine?.id ?? 'none');
    if (skinCheck.today || skinCheck.yesterday) {
      const today = skinCheck.today;
      const yesterday = skinCheck.yesterday;
      const comparison = today && yesterday ? compareDailySkinChecks(yesterday, today) : null;
      const summarize = (check: NonNullable<typeof today>) => ({ date: check.localDate, ratings: check.ratings });
      previews['skin-check'] = makeAttachment('skin-check', 'Today vs Yesterday', comparison?.summary || (today ? 'Today’s check-in' : 'Yesterday’s check-in'), { ...(yesterday ? { yesterday: summarize(yesterday) } : {}), ...(today ? { today: summarize(today) } : {}), ...(comparison ? { comparison: { status: comparison.overallStatus, summary: comparison.summary } } : {}) }, today?.localDate);
    }
    setPickerPreviews((current) => ({ ...current, ...previews, ...(current.routine?.sourceId === routine?.id && routinePreviewKeyRef.current === routinePreviewKey ? { routine: current.routine } : {}) }));

    const loadProfileAndShelf = async () => {
      const [cachedProfile, cachedShelf] = await Promise.all([
        getCachedSkinAIContext(userId, `skin-profile:${userId}`).catch(() => null),
        getCachedShelfItems(userId).catch(() => null),
      ]);
      if (routineRows.length && routinePreviewKeyRef.current !== routinePreviewKey) {
        const resolvedProducts = await getRoutineProductSummaries(userId, routineSteps).catch(() => null);
        if (resolvedProducts) {
          const detailedSteps = routineRows.map((step) => {
            const product = resolvedProducts.get(step.id);
            return { ...step, name: product?.name || step.name, imageUrl: product?.imageUrl || null, brand: product?.brand || null };
          });
          const routineAttachment = makeAttachment('routine', 'My Routine', routineSummary(detailedSteps), { steps: detailedSteps }, routine?.id);
          routinePreviewKeyRef.current = routinePreviewKey;
          previews.routine = routineAttachment;
          if (active) setPickerPreviews((current) => ({ ...current, routine: routineAttachment }));
        }
      }
      if (cachedProfile) previews['skin-profile'] = cachedProfile;
      else {
        try {
          const row = await getSkinProfile(userId);
          if (row?.onboarding_completed) {
            const profile = profileFromRow(row);
            const summary = [profile.skinType && `${readable(profile.skinType)} skin`, profile.sensitivity && `${readable(profile.sensitivity)} sensitivity`, profile.concerns.length && `Focus: ${profile.concerns.slice(0, 2).map(readable).join(', ')}`, profile.goals.length && `Goals: ${profile.goals.slice(0, 2).map(readable).join(', ')}`].filter(Boolean).join(' · ');
            const attachment = makeAttachment('skin-profile', 'My Skin', summary || 'Skin profile', profile as unknown as Record<string, unknown>, userId);
            previews['skin-profile'] = attachment;
            void cacheSkinAIContext(userId, `skin-profile:${userId}`, attachment);
          }
        } catch { /* The picker remains usable when profile preview data is offline. */ }
      }
      if (cachedShelf) {
        if (cachedShelf.length) {
          try {
            const ids = [...new Set(cachedShelf.slice(0, 4).map((item) => item.productId))];
            const cachedProducts = await getCachedProductsByIds(ids);
            const shelfProducts = cachedShelf.slice(0, 16).map((item) => {
              const product = cachedProducts.get(item.productId);
              return { productId: item.productId, name: product?.name || `Product ${item.productId}`, brand: product?.brand || null, category: product?.category || null, imageUrl: product?.imageUrl || null };
            });
            previews.shelf = makeAttachment('shelf', 'My Shelf', shelfSummary(cachedShelf.length, shelfProducts), { products: shelfProducts }, userId);
          } catch { /* Use a simple shelf label if the local product cache is unavailable. */ }
        }
      } else {
        try {
          const shelf = await listShelfItems(userId);
          const shelfProducts = shelf.items.slice(0, 16).map((item) => ({ productId: item.productId, name: item.product?.name || `Product ${item.productId}`, brand: item.product?.brand || null, category: item.product?.category || null, imageUrl: item.product?.imageUrl || null }));
          if (shelfProducts.length) previews.shelf = makeAttachment('shelf', 'My Shelf', shelfSummary(shelf.items.length, shelfProducts), { products: shelfProducts }, userId);
        } catch { /* Keep empty/offline shelf context available in the picker. */ }
      }
      if (active) setPickerPreviews((current) => ({ ...current, ...previews, ...(current.routine?.sourceId === routine?.id && routinePreviewKeyRef.current === routinePreviewKey ? { routine: current.routine } : {}) }));
    };
    void loadProfileAndShelf();
    return () => { active = false; };
  }, [chooserVisible, pickerOpenCount, userId]);

  useEffect(() => {
    let active = true;
    historyOwner.current = userId;
    setMessages([]); setAttachments([]); setError(null); setLoadingHistory(Boolean(userId));
    if (!userId) { setLoadingHistory(false); return () => { active = false; }; }
    void loadSkinAIHistory(userId).then((history) => {
      if (active && historyOwner.current === userId) setMessages(history);
    }).catch(() => { if (active) setError('Chat history could not be opened on this device.'); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; requestRef.current?.abort(); };
  }, [userId]);

  useEffect(() => {
    const type = params.contextType as SkinAIContextType | undefined;
    if (!userId || !type || !['skin-profile', 'routine', 'skin-check', 'shelf', 'product', 'product-evidence', 'progress-photo'].includes(type)) return;
    let active = true;
    void attachContext(type, params.contextId, params.contextLabel).finally(() => { if (active) router.setParams({ contextType: undefined, contextId: undefined, contextLabel: undefined }); });
    return () => { active = false; };
    // Route parameters are a one-shot context request, not reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, params.contextType, params.contextId]);

  useEffect(() => {
    if (productQuery.trim().length < 2) { setProductResults([]); setProductSearching(false); setProductSearchError(null); return; }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setProductSearching(true); setProductSearchError(null);
      void searchProducts(productQuery.trim(), 0, controller.signal).then((result) => { if (active) setProductResults(result.items.slice(0, 8)); })
        .catch((reason) => { if (active && !controller.signal.aborted) setProductSearchError(reason instanceof Error ? reason.message : 'Search could not load.'); })
        .finally(() => { if (active) setProductSearching(false); });
    }, 320);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [productQuery]);

  const addAttachment = useCallback((attachment: SkinAIContextAttachment) => {
    setAttachments((current) => current.some((item) => item.type === attachment.type && item.sourceId === attachment.sourceId && item.id === attachment.id)
      ? current : [...current, attachment]);
  }, []);
  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const showContextPicker = useCallback(() => {
    Keyboard.dismiss();
    contextProgress.setValue(0);
    setPickerOpenCount((count) => count + 1);
    setChooserVisible(true);
    requestAnimationFrame(() => Animated.spring(contextProgress, { toValue: 1, speed: 22, bounciness: 3, useNativeDriver: true }).start());
  }, [contextProgress]);
  const hideContextPicker = useCallback(() => {
    Animated.timing(contextProgress, { toValue: 0, duration: 150, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setChooserVisible(false); setSelectingProduct(false); setProductQuery(''); setProductResults([]); Keyboard.dismiss();
    });
  }, [contextProgress]);

  const attachContext = useCallback(async (type: SkinAIContextType, sourceId?: string, routeLabel?: string) => {
    if (!userId) return;
    setBusyContext(type); setError(null);
    try {
      const cacheable = type === 'skin-profile' || type === 'shelf';
      const cacheKey = `${type}:${sourceId || userId}`;
      if (cacheable) {
        const cached = await getCachedSkinAIContext(userId, cacheKey);
        if (cached) { addAttachment(cached); return; }
      }
      if (type === 'skin-profile') {
        const row = await getSkinProfile(userId);
        if (!row?.onboarding_completed) throw new Error('Your skin profile is not available yet.');
        const profile = profileFromRow(row);
        const summary = [profile.skinType && `${readable(profile.skinType)} skin`, profile.sensitivity && `${readable(profile.sensitivity)} sensitivity`, profile.concerns.length && `Focus: ${profile.concerns.slice(0, 2).map(readable).join(', ')}`, profile.goals.length && `Goals: ${profile.goals.slice(0, 2).map(readable).join(', ')}`, profile.preferences.length && `Preferences: ${profile.preferences.slice(0, 2).map(readable).join(', ')}`].filter(Boolean).join(' · ');
        const attachment = makeAttachment(type, 'My Skin', summary || 'Skin profile', profile as unknown as Record<string, unknown>, userId);
        await cacheSkinAIContext(userId, cacheKey, attachment); addAttachment(attachment);
      } else if (type === 'routine') {
        const activeRoutine = routineSnapshot.routines.find((item) => item.isActive) || routineSnapshot.routines[0];
        const steps = routineSnapshot.steps.filter((step) => step.routineId === activeRoutine?.id && step.enabled).sort((a, b) => a.position - b.position);
        if (!steps.length) throw new Error('There are no routine steps to attach yet.');
        const date = localDateKey();
        const rows = steps.map((step) => ({ id: step.id, name: step.title, period: step.period, productId: step.productId, shelfItemId: step.shelfItemId, todayStatus: routineSnapshot.logs.find((log) => log.stepId === step.id && log.logDate === date && !log.deletedAt)?.status || 'pending' }));
        addAttachment(makeAttachment(type, 'My Routine', routineSummary(rows), { steps: rows }, activeRoutine?.id));
      } else if (type === 'skin-check') {
        const today = skinCheck.today;
        const yesterday = skinCheck.yesterday;
        if (!today && !yesterday) throw new Error('No local skin check-ins are available yet.');
        const comparison = today && yesterday ? compareDailySkinChecks(yesterday, today) : null;
        const summarizeCheck = (check: NonNullable<typeof today>) => ({ date: check.localDate, ratings: check.ratings, morningRoutineCompleted: check.amRoutineCompleted, eveningRoutineCompleted: check.pmRoutineCompleted, newProductStarted: check.newProductStarted });
        const data = { ...(yesterday ? { yesterday: summarizeCheck(yesterday) } : {}), ...(today ? { today: summarizeCheck(today) } : {}), ...(comparison ? { comparison: { status: comparison.overallStatus, summary: comparison.summary, suggestion: comparison.suggestion } } : {}) };
        addAttachment(makeAttachment(type, 'Today vs Yesterday', comparison?.summary || (today ? 'Today’s check-in' : 'Yesterday’s check-in'), data, today?.localDate));
        if (yesterday?.photoUri) addAttachment(progressPhotoAttachment('Yesterday', yesterday));
        if (today?.photoUri) addAttachment(progressPhotoAttachment('Today', today));
      } else if (type === 'shelf') {
        const cachedShelf = await getCachedShelfItems(userId).catch(() => null);
        let shelfCount: number | null = cachedShelf?.length ?? null;
        let shelfProducts: Array<{ productId: number; name: string; brand: string | null; category: string | null; imageUrl: string | null }> | null = null;
        if (cachedShelf) {
          const cachedProducts = await getCachedProductsByIds([...new Set(cachedShelf.map((item) => item.productId))]).catch(() => new Map());
          if (cachedShelf.every((item) => cachedProducts.has(item.productId))) shelfProducts = cachedShelf.slice(0, 16).map((item) => {
            const product = cachedProducts.get(item.productId);
            return { productId: item.productId, name: product?.name || `Product ${item.productId}`, brand: product?.brand || null, category: product?.category || null, imageUrl: product?.imageUrl || null };
          });
        }
        if (!shelfProducts) {
          const { items, offline } = await listShelfItems(userId);
          if (!items.length) throw new Error(offline ? 'Your saved shelf is not available offline.' : 'Your shelf is empty.');
          shelfCount = items.length;
          shelfProducts = items.slice(0, 16).map((item) => ({ productId: item.productId, name: item.product?.name || `Product ${item.productId}`, brand: item.product?.brand || null, category: item.product?.category || null, imageUrl: item.product?.imageUrl || null }));
        }
        if (!shelfProducts.length) throw new Error('Your shelf is empty.');
        const products = shelfProducts;
        const total = shelfCount ?? products.length;
        const attachment = makeAttachment(type, 'My Shelf', shelfSummary(total, products), { products }, userId);
        await cacheSkinAIContext(userId, cacheKey, attachment); addAttachment(attachment);
      } else if (type === 'product' || type === 'product-evidence') {
        if (!sourceId) { setSelectingProduct(true); setProductQuery(''); showContextPicker(); return; }
        const productId = Number(sourceId);
        if (!Number.isSafeInteger(productId) || productId < 1) throw new Error('That product could not be opened.');
        const cachedProduct = await getCachedProduct(productId).catch(() => null);
        const result = cachedProduct ? { product: cachedProduct.product } : await getProductDetail(productId);
        if (!result.product) throw new Error('Product details are not available on this device.');
        const selectedProfile = attachments.find((item) => item.type === 'skin-profile');
        const profile = selectedProfile?.data as unknown as SkinProfile | undefined;
        const product = result.product;
        const formula = product.formulas[0];
        const match = profile ? scoreProductMatch(product, profile) : null;
        const responsible = match ? [...match.strongestPositives, ...match.strongestConcerns].flatMap((reason) => reason.ingredientNames).slice(0, 6) : [];
        const data = {
          productId: product.productId, name: product.name, brand: product.brand, category: product.category, imageUrl: formula?.imageUrl || product.imageUrl,
          formulaId: formula?.id, ingredientNames: formula?.ingredients.slice(0, 18).map((ingredient) => ingredient.inciName || ingredient.name),
          formulaAnalysis: formula?.analysis.slice(0, 10).map((item) => ({ label: item.label, kind: item.kind, state: item.state, ingredients: item.responsibleIngredients.slice(0, 4).map((ingredient) => ingredient.inciName || ingredient.name) })),
          skinMatch: match ? { score: match.score, confidence: match.confidence, positives: match.strongestPositives.slice(0, 3).map((reason) => reason.label), concerns: match.strongestConcerns.slice(0, 3).map((reason) => reason.label), linkedIngredients: [...new Set(responsible)].slice(0, 6) } : undefined,
          hasParsedFormula: product.hasParsedFormula,
        };
        const label = routeLabel?.includes(' · ') ? routeLabel.split(' · ').slice(-1)[0] || product.name : routeLabel || product.name;
        addAttachment(makeAttachment('product-evidence', label, `${product.brand}${product.category ? ` · ${product.category}` : ''}${formula?.ingredients.length ? ` · ${formula.ingredients.length} ingredients` : ' · formula unavailable'}`, data, product.productId));
        setSelectingProduct(false); setProductQuery('');
      } else if (type === 'progress-photo') {
        if (skinCheck.yesterday?.photoUri) addAttachment(progressPhotoAttachment('Yesterday', skinCheck.yesterday));
        if (skinCheck.today?.photoUri) addAttachment(progressPhotoAttachment('Today', skinCheck.today));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That context could not be added.');
    } finally { setBusyContext(null); }
  }, [addAttachment, attachments, hideContextPicker, routineSnapshot, showContextPicker, skinCheck.today, skinCheck.yesterday, userId]);

  const send = useCallback(async (suggestion?: string) => {
    const text = (suggestion || draft).trim();
    if (!text || !userId || typing) return;
    Keyboard.dismiss(); setDraft(''); setError(null);
    const userMessage: SkinAIMessage = { id: newId(), role: 'user', text, createdAt: new Date().toISOString(), attachments: attachments.map((item) => ({ ...item })) };
    const next = [...messages, userMessage];
    setMessages(next); setAttachments([]); setTyping(true);
    try {
      await saveSkinAIMessage(userId, userMessage);
      const controller = new AbortController(); requestRef.current = controller;
      const response = await AIChatService.answer(text, userMessage.attachments || [], messages, controller.signal);
      if (historyOwner.current !== userId) return;
      const reply: SkinAIMessage = { id: newId(), role: 'assistant', text: response.text, createdAt: new Date().toISOString() };
      setMessages((current) => [...current, reply]);
      await saveSkinAIMessage(userId, reply);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message.toLowerCase().includes('cancel'))) setError(reason instanceof Error ? reason.message : 'Skin AI could not reply. Try again.');
    } finally { requestRef.current = null; setTyping(false); }
  }, [attachments, draft, messages, typing, userId]);

  const latestPrompt = useMemo(() => messages.length === 0, [messages.length]);
  const selectedProducts = useMemo(() => attachments.filter((item) => item.type === 'product-evidence'), [attachments]);
  const comparisonDays = [
    { label: 'Yesterday', check: skinCheck.yesterday },
    { label: 'Today', check: skinCheck.today },
  ];
  const comparisonPhotos = comparisonDays.filter((item): item is { label: string; check: NonNullable<typeof item.check> } => Boolean(item.check?.photoUri));

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 3 : 0}>
          <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })} showsVerticalScrollIndicator={false}>
            {loadingHistory ? <View style={styles.loadingHistory}><ActivityIndicator size="small" color="#55765d" /><Text style={styles.muted}>Opening your local chat…</Text></View> : null}
            {latestPrompt && !loadingHistory ? (
              <Animated.View style={[styles.welcome, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
                <Text style={styles.welcomeTitle}>What would you like to understand?</Text>
                <Text style={styles.welcomeCopy}>Ask about your skin, routine, or a product. Add context whenever it helps.</Text>
                <View style={styles.quickSection}>
                  <View style={styles.quickSectionHeader}><Text style={styles.quickSectionTitle}>Your SkinDecode</Text><Pressable onPress={showContextPicker} style={styles.viewAll}><Text style={styles.viewAllText}>Choose context</Text><Feather name="chevron-right" size={13} color="#68806b" /></Pressable></View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActions}>
                    {CONTEXT_CHOICES.map((choice) => <Pressable key={choice.type} disabled={busyContext === choice.type} onPress={() => choice.type === 'product' ? (setSelectingProduct(true), setProductQuery(''), setProductResults([]), showContextPicker()) : void attachContext(choice.type)} style={({ pressed }) => [styles.quickAction, attachments.some((item) => item.type === choice.type || (choice.type === 'product' && item.type === 'product-evidence')) && styles.quickActionSelected, pressed && styles.pressed]}><Feather name={choice.icon} size={14} color="#527259" /><Text style={styles.quickActionText}>{choice.label}</Text>{attachments.some((item) => item.type === choice.type || (choice.type === 'product' && item.type === 'product-evidence')) ? <Feather name="check" size={11} color="#527259" /> : null}</Pressable>)}
                  </ScrollView>
                </View>
                <View style={styles.promptSection}><Text style={styles.promptHeading}>Try asking</Text>{QUICK_QUESTIONS.slice(0, 4).map((question, index) => <Pressable key={question} onPress={() => void send(question)} style={({ pressed }) => [styles.promptRow, index === 0 && styles.promptRowFirst, pressed && styles.pressed]}><Text style={styles.promptText}>{question}</Text><Feather name="arrow-up-right" size={15} color="#748579" /></Pressable>)}</View>
              </Animated.View>
            ) : null}

            {messages.map((message) => (
              <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.userMessageRow]}>
                {message.role === 'assistant' ? <View style={styles.messageMark}><Feather name="droplet" size={12} color="#4e7255" /></View> : null}
                <View style={[styles.messageBubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                  {message.attachments?.length ? <View style={styles.messageContextList}>{message.attachments.map((item) => <View key={item.id} style={styles.messageContext}><Feather name={iconFor(item.type)} size={10} color="#55765d" /><Text numberOfLines={1} style={styles.messageContextLabel}>{item.label}</Text></View>)}</View> : null}
                  <Text style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text>
                </View>
              </View>
            ))}
            {typing ? <View style={styles.typingRow}><View style={styles.messageMark}><Feather name="droplet" size={12} color="#4e7255" /></View><View style={styles.typingBubble}><TypingDots /></View><Text style={styles.typingLabel}>Thinking…</Text></View> : null}
            {error ? <View style={styles.errorBanner}><Feather name="alert-circle" size={14} color="#92594f" /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => setError(null)}><Feather name="x" size={15} color="#92594f" /></Pressable></View> : null}
          </ScrollView>

          <View style={[styles.composerDock, { paddingBottom: keyboardVisible ? 4 : 84 }]}>
            {attachments.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewStrip}>{attachments.map((item) => <CompactAttachment key={item.id} attachment={item} onRemove={() => removeAttachment(item.id)} />)}</ScrollView> : null}
            <View style={styles.composerWrap}>
              <Pressable accessibilityRole="button" accessibilityLabel="Attach context" onPress={showContextPicker} style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}><Feather name="plus" size={21} color="#48684e" /></Pressable>
              <TextInput value={draft} onChangeText={setDraft} placeholder="Ask about your skin…" placeholderTextColor="#929c91" style={styles.composerInput} multiline maxLength={1_200} returnKeyType="default" accessibilityLabel="Ask Skin AI" />
              <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || typing} onPress={() => void send()} style={({ pressed }) => [styles.sendButton, (!draft.trim() || typing) && styles.sendDisabled, pressed && styles.pressed]}>{typing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="arrow-up" size={17} color="#fff" />}</Pressable>
            </View>
            <Text style={styles.privacyNote}></Text>
          </View>
        </KeyboardAvoidingView>

        <Modal visible={chooserVisible} animationType="none" transparent onRequestClose={hideContextPicker}>
          <View style={styles.modalRoot}><Animated.View style={[styles.scrim, { opacity: contextProgress }]}><Pressable style={styles.scrimPressable} onPress={hideContextPicker} /></Animated.View><Animated.View style={[styles.sheet, { opacity: contextProgress, transform: [{ translateY: contextProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
            <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Choose what to share</Text><Text style={styles.sheetCopy}>Only selected details are added to your message.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close context picker" onPress={hideContextPicker} style={styles.closeButton}><Feather name="x" size={17} color="#506153" /></Pressable></View>
            <View style={styles.stickyProductSearch}><View style={styles.productSearch}><Feather name="search" size={15} color="#67806a" /><TextInput ref={productSearchInputRef} value={productQuery} onFocus={() => setSelectingProduct(true)} onChangeText={setProductQuery} placeholder="Search your products" placeholderTextColor="#99a397" style={styles.productSearchInput} autoCorrect={false} autoCapitalize="none" /></View></View>
            <View style={styles.pickerBody}>
            <ScrollView style={styles.contextList} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
            <View style={styles.contextGrid}>{CONTEXT_CHOICES.filter((choice) => choice.type !== 'product').map((choice) => {
              const selectedAttachment = attachments.find((item) => item.type === choice.type);
              const previewAttachment = selectedAttachment || pickerPreviews[choice.type];
              const selected = Boolean(selectedAttachment);
              return <View key={choice.type} style={[styles.contextOptionFrame, selected && styles.contextOptionFrameSelected]}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityHint={selected && choice.type !== 'product' ? 'Tap again to remove this context.' : undefined} accessibilityLabel={selected && choice.type !== 'product' ? `Remove ${choice.label} context` : `Choose ${choice.label} context`} disabled={busyContext === choice.type} onPress={() => {
                if (selectedAttachment) {
                  removeAttachment(selectedAttachment.id);
                  if (choice.type === 'skin-check') comparisonPhotos.forEach(({ check }) => removeAttachment(`progress-photo:${check.localDate}`));
                  return;
                }
                if (previewAttachment) {
                  addAttachment(previewAttachment);
                  if (choice.type === 'skin-check') comparisonPhotos.forEach(({ label, check }) => addAttachment(progressPhotoAttachment(label, check)));
                } else void attachContext(choice.type);
              }} style={({ pressed }) => [styles.contextOption, pressed && styles.pressed]}>
              <View style={styles.contextOptionTop}><View style={[styles.contextIcon, selected && styles.contextIconSelected]}><Feather name={choice.icon} size={15} color={selected ? '#31543b' : '#617568'} /></View>{busyContext === choice.type ? <ActivityIndicator size="small" color="#55765d" /> : selected ? <View style={styles.contextSelectedMark}><Feather name="check" size={10} color="#fff" /></View> : <View style={styles.contextAddMark}><Feather name="plus" size={11} color="#647767" /></View>}</View>
              <Text numberOfLines={1} style={styles.contextTitle}>{choice.label}</Text>
              {previewAttachment ? <ContextTilePreview attachment={previewAttachment} comparisonDays={choice.type === 'skin-check' ? comparisonDays : undefined} /> : <View style={styles.contextEmptyPreview}><Text numberOfLines={2} style={styles.contextHint}>{choice.hint}</Text></View>}
              </Pressable>
              </View>; })}
            </View>

            </ScrollView>
            {selectingProduct && productQuery.trim().length > 0 ? <View style={styles.productResultsOverlay}>
              {productQuery.trim().length < 2 ? <Text style={styles.productSearchStateText}>Type at least 2 characters.</Text> : productSearching ? <ActivityIndicator style={styles.productSearchState} size="small" color="#55765d" /> : productSearchError ? <Text style={styles.productSearchStateText}>{productSearchError}</Text> : productResults.length ? <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} style={styles.productResultsList}>{productResults.map((product) => {
                const alreadySelected = selectedProducts.some((item) => String(item.sourceId) === String(product.productId));
                return <Pressable key={product.productId} accessibilityRole="button" accessibilityState={{ selected: alreadySelected }} onPress={() => alreadySelected ? removeAttachment(selectedProducts.find((item) => String(item.sourceId) === String(product.productId))!.id) : void attachContext('product', String(product.productId), `${product.brand} · ${product.name}`)} style={[styles.productResult, alreadySelected && styles.productResultSelected]}><SelectionThumbnail uri={product.imageUrl} /><View style={styles.productResultCopy}><Text numberOfLines={1} style={styles.productResultBrand}>{product.brand}</Text><Text numberOfLines={1} style={styles.productResultName}>{product.name}</Text><Text numberOfLines={1} style={styles.productResultMeta}>{product.category || 'Skincare product'}{product.subcategory ? ` · ${product.subcategory}` : ''}</Text></View><View style={[styles.productResultAction, alreadySelected && styles.productResultActionSelected]}><Feather name={alreadySelected ? 'check' : 'plus'} size={14} color={alreadySelected ? '#fff' : '#55765d'} /></View></Pressable>;
              })}</ScrollView> : <Text style={styles.productSearchPrompt}>No products found. Try a shorter name or brand.</Text>}
            </View> : null}
            </View>
            <View style={styles.sheetFooter}><Text style={styles.sheetPrivacy}>{attachments.length ? `${attachments.length} selected · tap a selected tile to remove it` : 'Nothing is shared until you send your message'}</Text><Pressable onPress={hideContextPicker} style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}><Text style={styles.doneButtonText}>Done</Text></Pressable></View>
          </Animated.View></View>
        </Modal>
      </SafeAreaView>
    </TabScreenTransition>
  );
}

type PreviewProduct = { productId?: number; name: string; brand?: string | null; category?: string | null; imageUrl?: string | null };
type PreviewRoutineStep = { id?: string; name: string; period: string; imageUrl?: string | null; productName?: string | null; brand?: string | null };

function shelfSummary(total: number, products: PreviewProduct[]) {
  const names = products.slice(0, 2).map((product) => product.name).filter(Boolean).join(', ');
  const remaining = Math.max(0, total - Math.min(2, products.length));
  return `${total} ${total === 1 ? 'product' : 'products'}${names ? ` · ${names}` : ''}${remaining ? ` +${remaining}` : ''}`;
}

function routineSummary(rows: PreviewRoutineStep[]) {
  if (!rows.length) return 'No routine steps yet';
  const periodSummary = (period: string) => {
    const steps = rows.filter((row) => row.period === period);
    const name = steps[0]?.name;
    return `${period.toUpperCase()}${steps.length ? ` ${steps.length}` : ''}${name ? ` · ${name}` : ''}${steps.length > 1 ? ` +${steps.length - 1}` : ''}`;
  };
  return `${rows.length} steps · ${periodSummary('am')} · ${periodSummary('pm')}`;
}

function attachmentProducts(attachment: SkinAIContextAttachment): PreviewProduct[] {
  const value = attachment.data?.products;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PreviewProduct[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string') return [];
    return [{ productId: typeof row.productId === 'number' ? row.productId : undefined, name: row.name, brand: typeof row.brand === 'string' ? row.brand : null, category: typeof row.category === 'string' ? row.category : null, imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null }];
  });
}

function ContextTilePreview({ attachment, comparisonDays = [] }: { attachment: SkinAIContextAttachment; comparisonDays?: Array<{ label: string; check: DailySkinCheck | null }> }) {
  const data = attachment.data || {};
  const products = attachmentProducts(attachment);
  if (attachment.type === 'product-evidence') return <View style={styles.tileProduct}><PreviewImage uri={typeof data.imageUrl === 'string' ? data.imageUrl : null} compact /><View style={styles.tileProductCopy}><Text numberOfLines={1} style={styles.tilePreviewText}>{typeof data.name === 'string' ? data.name : attachment.label}</Text><Text numberOfLines={1} style={styles.tileMeta}>{[data.brand, data.category, Array.isArray(data.ingredientNames) ? `${data.ingredientNames.length} ingredients` : data.hasParsedFormula ? 'Formula available' : 'No parsed formula'].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ')}</Text></View></View>;
  if (attachment.type === 'shelf') return <View style={styles.tileShelf}><View style={styles.tileImageRow}>{products.slice(0, 3).map((product, index) => <PreviewImage key={`${product.productId ?? product.name}-${index}`} uri={product.imageUrl} compact />)}{products.length > 3 ? <View style={styles.tileMoreBubble}><Text style={styles.tileMore}>+{products.length - 3}</Text></View> : null}</View><Text numberOfLines={1} style={styles.tileMeta}>{products.length ? products.slice(0, 2).map((item) => item.name).join(' · ') : attachment.summary}</Text></View>;
  if (attachment.type === 'routine') {
    const steps = Array.isArray(data.steps) ? data.steps.filter((step) => step && typeof step === 'object') as Array<Record<string, unknown>> : [];
    return <View style={styles.tileRoutine}>{(['am', 'pm'] as const).map((period) => {
      const periodSteps = steps.filter((step) => step.period === period);
      return <View key={period} style={styles.tileRoutineLine}>
        <View style={[styles.tileRoutineDot, period === 'am' ? styles.tileRoutineAm : styles.tileRoutinePm]}><Feather name={period === 'am' ? 'sun' : 'moon'} size={9} color={period === 'am' ? '#927449' : '#69758d'} /></View>
        <View style={styles.tileRoutineCopy}><Text style={styles.tileRoutineStrong}>{period === 'am' ? 'Morning' : 'Evening'}</Text><Text style={styles.tileRoutineCount}>{periodSteps.length} {periodSteps.length === 1 ? 'step' : 'steps'}</Text></View>
        <View style={styles.tileRoutineProducts}>{periodSteps.slice(0, 4).map((step, index) => <View key={String(step.id || `${period}-${index}`)} style={[styles.tileRoutineThumb, index > 0 && styles.tileRoutineThumbOverlap]}>{typeof step.imageUrl === 'string' && step.imageUrl ? <Image source={{ uri: step.imageUrl }} resizeMode="contain" style={styles.tileRoutineProductImage} /> : <RoutineBottle size="preview" />}</View>)}{periodSteps.length > 4 ? <Text style={styles.tileRoutineMore}>+{periodSteps.length - 4}</Text> : null}</View>
      </View>;
    })}</View>;
  }
  if (attachment.type === 'progress-photo') return <View style={styles.tilePhoto}><PreviewImage uri={attachment.localPhotoUri} compact /><View style={styles.tileProductCopy}><Text style={styles.tilePreviewText}>Saved skin photo</Text><Text numberOfLines={1} style={styles.tileMeta}>{typeof attachment.sourceId === 'string' ? attachment.sourceId : 'Stored on this device'}</Text></View></View>;
  if (attachment.type === 'skin-profile') {
    const concerns = Array.isArray(data.concerns) ? data.concerns.filter((value): value is string => typeof value === 'string') : [];
    const goals = Array.isArray(data.goals) ? data.goals.filter((value): value is string => typeof value === 'string') : [];
    return <View style={styles.tileProfile}><Text numberOfLines={1} style={styles.tilePreviewText}>{[readable(data.skinType) && `${readable(data.skinType)} skin`, readable(data.sensitivity) && `${readable(data.sensitivity)} sensitivity`].filter(Boolean).join(' · ') || 'Skin profile ready'}</Text><View style={styles.tileTagRow}>{[...concerns.slice(0, 2).map((value) => `Focus · ${readable(value)}`), ...goals.slice(0, 1).map((value) => `Goal · ${readable(value)}`)].map((value) => <Text key={value} numberOfLines={1} style={styles.tileTag}>{value}</Text>)}</View></View>;
  }
  const today = data.today && typeof data.today === 'object' ? data.today as Record<string, unknown> : null;
  const yesterday = data.yesterday && typeof data.yesterday === 'object' ? data.yesterday as Record<string, unknown> : null;
  const ratings = today?.ratings && typeof today.ratings === 'object' ? today.ratings as Record<string, unknown> : null;
  const ratingLabels = ['acne', 'redness', 'dryness', 'oiliness', 'irritation'];
  const metricValues = ratingLabels.map((key) => ({
    key,
    label: key === 'acne' ? 'Breakouts' : readable(key),
    yesterday: typeof ((yesterday?.ratings as Record<string, unknown> | undefined)?.[key]) === 'number' ? ((yesterday?.ratings as Record<string, unknown>)[key] as number) : null,
    today: typeof ratings?.[key] === 'number' ? ratings[key] as number : null,
  }));
  return <View style={styles.tileCheck}><View style={styles.tileComparePhotos}>{comparisonDays.map(({ label, check }) => <View key={label} style={styles.tileComparePhotoCell}>{check?.photoUri ? <Image source={{ uri: check.photoUri }} style={styles.tileComparePhoto} /> : <View style={[styles.tileComparePhoto, styles.tileComparePhotoEmpty]}><Feather name="camera" size={13} color="#9aa99b" /></View>}<Text style={styles.tileComparePhotoLabel}>{label}</Text></View>)}</View>{metricValues.slice(0, 2).map((metric) => <View key={metric.key} style={styles.tileMetricRow}><Text numberOfLines={1} style={styles.tileMetricLabel}>{metric.label}</Text><View style={styles.tileMetricScores}><View style={[styles.tileMetricValue, metric.yesterday !== null && styles.tileMetricValueFilled]}><Text style={[styles.tileMetricValueText, metric.yesterday !== null && styles.tileMetricValueTextFilled]}>{metric.yesterday ?? '—'}</Text></View><Feather name="arrow-right" size={9} color="#a1aaa0" /><View style={[styles.tileMetricValue, metric.today !== null && styles.tileMetricToday]}><Text style={[styles.tileMetricValueText, metric.today !== null && styles.tileMetricValueTextFilled]}>{metric.today ?? '—'}</Text></View></View></View>)}<View style={styles.tileMetricMoreRow}><Text style={styles.tileMetricMore}>+3 more</Text><Text style={styles.tileMetricMoreHint}>skin signals</Text></View></View>;
}

function CompactAttachment({ attachment, onRemove }: { attachment: SkinAIContextAttachment; onRemove: () => void }) {
  const data = attachment.data || {};
  const products = attachmentProducts(attachment);
  const imageUri = attachment.type === 'product-evidence' && typeof data.imageUrl === 'string' ? data.imageUrl : attachment.localPhotoUri;
  return (
    <View style={styles.compactAttachment}>
      {imageUri ? <Image source={{ uri: imageUri }} resizeMode="contain" style={styles.compactAttachmentImage} /> : attachment.type === 'shelf' ? <View style={styles.compactShelfImages}>{products.slice(0, 2).map((product, index) => <PreviewImage key={`${product.productId ?? product.name}-${index}`} uri={product.imageUrl} compact />)}</View> : <View style={styles.compactAttachmentIcon}><Feather name={iconFor(attachment.type)} size={14} color="#55715a" /></View>}
      <View style={styles.compactAttachmentCopy}><Text numberOfLines={1} style={styles.compactAttachmentLabel}>{attachment.type === 'product-evidence' && typeof data.name === 'string' ? data.name : attachment.label}</Text><Text numberOfLines={1} style={styles.compactAttachmentSummary}>{attachment.type === 'product-evidence' ? [data.brand, data.category].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ') || 'Product details attached' : attachment.type === 'shelf' ? `${products.length} products` : attachment.summary}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.label}`} onPress={onRemove} hitSlop={8} style={styles.compactRemove}><Feather name="x" size={12} color="#718075" /></Pressable>
    </View>
  );
}

function PreviewImage({ uri, compact = false }: { uri?: string | null; compact?: boolean }) {
  return uri ? <Image source={{ uri }} resizeMode="contain" style={[styles.previewImage, compact && styles.previewImageCompact]} /> : <View style={[styles.previewImage, styles.previewImagePlaceholder, compact && styles.previewImageCompact]}><Feather name="package" size={compact ? 13 : 17} color="#90a08f" /></View>;
}

function SelectionThumbnail({ uri }: { uri?: string | null }) {
  return uri ? <Image source={{ uri }} resizeMode="contain" style={styles.selectionThumbnail} /> : <View style={[styles.selectionThumbnail, styles.previewImagePlaceholder]}><Feather name="image" size={13} color="#90a08f" /></View>;
}

function previewStepNames(steps: PreviewRoutineStep[]) {
  if (!steps.length) return 'No steps';
  const names = steps.slice(0, 2).map((step) => step.name).join(' · ');
  return steps.length > 2 ? `${names} +${steps.length - 2}` : names;
}

function iconFor(type: SkinAIContextType): React.ComponentProps<typeof Feather>['name'] {
  if (type === 'skin-profile') return 'user';
  if (type === 'routine') return 'sun';
  if (type === 'skin-check') return 'activity';
  if (type === 'shelf') return 'briefcase';
  if (type === 'progress-photo') return 'image';
  return 'package';
}

function TypingDots() {
  const [pulse] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.25)));
  useEffect(() => {
    const animations = pulse.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 120), Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.timing(value, { toValue: 0.25, duration: 400, useNativeDriver: true }),
    ])));
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [pulse]);
  return <View style={styles.dots}>{pulse.map((value, index) => <Animated.View key={index} style={[styles.dot, { opacity: value, transform: [{ scale: value }] }]} />)}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, safeArea: { flex: 1, backgroundColor: '#f5f5f2' },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 21, paddingTop: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e7e9e3' },
  headerText: { flex: 1 }, title: { color: '#1c2d23', fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4 }, headerSubtitle: { color: '#78837b', fontSize: 12, marginTop: 1, fontWeight: '500' },
  localPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 15, backgroundColor: '#edf3eb' }, localDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#648269' }, localLabel: { color: '#58725d', fontSize: 9.5, fontWeight: '600' },
  chatContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 15, paddingBottom: 18 }, loadingHistory: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 14 }, muted: { color: '#859185', fontSize: 11 },
  welcome: { paddingTop: 23, paddingBottom: 18 }, welcomeTitle: { color: '#1c2d23', fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.55 }, welcomeCopy: { maxWidth: 315, marginTop: 6, color: '#78837b', fontSize: 13, lineHeight: 19 },
  quickSection: { marginTop: 24, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e0e5de' }, quickSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, quickSectionTitle: { color: '#314438', fontSize: 13, fontWeight: '700' }, viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 }, viewAllText: { color: '#55715a', fontSize: 11, fontWeight: '600' },
  quickActions: { gap: 8, paddingTop: 11, paddingBottom: 4 }, quickAction: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 18, backgroundColor: '#f8f8f5', borderWidth: 1, borderColor: '#e8ece5' }, quickActionSelected: { backgroundColor: '#eaf1e8', borderColor: '#d8e4d5' }, quickActionText: { color: '#465a4b', fontSize: 11, fontWeight: '600' },
  promptSection: { marginTop: 23 }, promptHeading: { color: '#314438', fontSize: 13, fontWeight: '700', marginBottom: 3 }, promptRow: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3e8e1', paddingVertical: 8 }, promptRowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e3e8e1' }, promptText: { flex: 1, color: '#526357', fontSize: 12, lineHeight: 16, fontWeight: '500' }, pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 8, paddingRight: 23 }, userMessageRow: { justifyContent: 'flex-end', paddingRight: 0, paddingLeft: 34 }, messageMark: { width: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7efe5' }, messageBubble: { maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 }, assistantBubble: { borderBottomLeftRadius: 5, backgroundColor: '#fff' }, userBubble: { borderBottomRightRadius: 5, backgroundColor: '#31543b' }, messageText: { color: '#405146', fontSize: 13, lineHeight: 19 }, userMessageText: { color: '#fff' }, messageContextList: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 8 }, messageContext: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: '#edf3eb' }, messageContextLabel: { maxWidth: 145, color: '#55715a', fontSize: 9, fontWeight: '700' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 9 }, typingBubble: { paddingHorizontal: 13, paddingVertical: 12, borderRadius: 15, backgroundColor: '#fff' }, dots: { flexDirection: 'row', gap: 4 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#63806a' }, typingLabel: { color: '#89948a', fontSize: 10 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 13, backgroundColor: '#f5ebe7', marginTop: 8 }, errorText: { flex: 1, color: '#92594f', fontSize: 11, lineHeight: 15 },
  previewStrip: { height: 48, gap: 6, paddingHorizontal: 17, paddingVertical: 1 }, compactAttachment: { width: 194, height: 46, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 7, borderRadius: 16, backgroundColor: '#f0f5ee', borderWidth: 1, borderColor: '#adc4aa' }, compactAttachmentImage: { width: 27, height: 34, borderRadius: 8, backgroundColor: '#f5f7f3' }, compactAttachmentIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e1ecde' }, compactAttachmentCopy: { flex: 1, minWidth: 0 }, compactAttachmentLabel: { color: '#35483a', fontSize: 10, fontWeight: '700' }, compactAttachmentSummary: { color: '#6f7f71', fontSize: 8.5, lineHeight: 10, marginTop: 1 }, compactShelfImages: { flexDirection: 'row', gap: 2 }, compactRemove: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e3ede0' }, selectionThumbnail: { width: 35, height: 42, borderRadius: 10, backgroundColor: '#f5f7f3' }, previewImage: { width: 44, height: 48, borderRadius: 10, backgroundColor: '#f5f7f3' }, previewImageCompact: { width: 29, height: 33, borderRadius: 8 }, previewImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  routinePreviewBody: { paddingHorizontal: 2 }, routinePreviewRow: { minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 7 }, periodBadge: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, amBadge: { backgroundColor: '#f7f1e3' }, pmBadge: { backgroundColor: '#edf0f7' }, periodPreviewLabel: { width: 49, color: '#506052', fontSize: 10, fontWeight: '700' }, periodPreviewSteps: { flex: 1, color: '#7d897f', fontSize: 9.5 }, routinePreviewDivider: { height: StyleSheet.hairlineWidth, marginLeft: 29, backgroundColor: '#edf0eb' },
  shelfPreviewBody: { gap: 5 }, shelfPreviewItems: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6 }, shelfPreviewItem: { width: 48, alignItems: 'center', gap: 3 }, shelfPreviewName: { width: 48, color: '#768278', textAlign: 'center', fontSize: 8, fontWeight: '500' }, shelfMore: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#edf3eb' }, shelfMoreText: { color: '#56705a', fontSize: 10, fontWeight: '700' }, profilePreviewBody: { gap: 7 }, previewTagRow: { flexDirection: 'row', gap: 5 }, previewTag: { maxWidth: 110, color: '#5c725e', backgroundColor: '#eef4ec', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, overflow: 'hidden', fontSize: 8.5, fontWeight: '600', textTransform: 'capitalize' }, photoPreviewBody: { flexDirection: 'row', alignItems: 'center', gap: 10 }, checkPreviewBody: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 4 }, checkDateColumn: { flex: 1, minWidth: 0 }, checkDateLabel: { color: '#869387', fontSize: 8, letterSpacing: 0.7, fontWeight: '700' },
  composerDock: { backgroundColor: '#f5f5f2' }, composerWrap: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 17, padding: 5, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e9e1' }, attachButton: { width: 39, height: 41, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' }, composerInput: { flex: 1, maxHeight: 88, paddingTop: 10, paddingBottom: 8, color: '#35463a', fontSize: 13 }, sendButton: { width: 39, height: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#31543b' }, sendDisabled: { backgroundColor: '#aab9aa' }, privacyNote: { color: '#8a968b', textAlign: 'center', fontSize: 9, marginTop: 6, marginBottom: 2 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }, scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(22,37,26,0.38)' }, scrimPressable: { ...StyleSheet.absoluteFill }, sheet: { width: '100%', maxWidth: 390, maxHeight: '88%', paddingHorizontal: 19, paddingTop: 16, paddingBottom: 12, borderRadius: 25, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4ebe1', shadowColor: '#1c3324', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 15 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sheetTitle: { color: '#263a2c', fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.35 }, closeButton: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f5f0' }, sheetCopy: { color: '#7d897e', fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  pickerBody: { position: 'relative' }, contextList: { flexShrink: 1, maxHeight: 510, marginTop: 12 }, productResultsOverlay: { position: 'absolute', top: 12, left: 0, right: 0, zIndex: 20, maxHeight: 250, overflow: 'hidden', borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3eae1', shadowColor: '#193220', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 14, elevation: 14 }, productResultsList: { maxHeight: 250, paddingHorizontal: 9 },
  contextGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingBottom: 2 },
  contextOptionFrame: { width: '48.5%', overflow: 'hidden', borderRadius: 17, backgroundColor: '#f8f9f6', borderWidth: 1, borderColor: '#e8ece6' }, contextOptionFrameSelected: { backgroundColor: '#f0f5ee', borderColor: '#adc4aa' },
  contextOption: { width: '100%', padding: 9, backgroundColor: 'transparent' },
  contextOptionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  contextIcon: { width: 27, height: 27, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf2eb' }, contextIconSelected: { backgroundColor: '#e1ecde' },
  contextTitle: { color: '#304437', fontSize: 12, fontWeight: '700', marginBottom: 3 }, contextHint: { color: '#7d897e', fontSize: 10, lineHeight: 14 }, contextEmptyPreview: { flex: 1, justifyContent: 'flex-start', paddingTop: 3 },
  contextSelectedMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#31543b' }, contextAddMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eef1eb' }, selectedCount: { color: '#547158', fontSize: 9.5, fontWeight: '700', marginTop: 3 },
  tilePreviewText: { color: '#4b5f4f', fontSize: 10.5, lineHeight: 14, fontWeight: '700' }, tileMeta: { color: '#738176', fontSize: 9.5, lineHeight: 13, marginTop: 2 }, tileProduct: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }, tileProductCopy: { flex: 1, minWidth: 0 }, tileShelf: { marginTop: 3 }, tileImageRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 31 }, tileMoreBubble: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e9efe6' }, tileMore: { color: '#55715a', fontSize: 9, fontWeight: '700' }, tileProfile: { gap: 6, marginTop: 4 }, tileTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, tileTag: { maxWidth: '100%', color: '#55715a', backgroundColor: '#e8f0e6', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, overflow: 'hidden', fontSize: 9, fontWeight: '600', textTransform: 'capitalize' }, tilePhoto: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  tileCheck: { marginTop: 2 }, tileComparePhotos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 4 }, tileComparePhotoCell: { width: 50, alignItems: 'center', gap: 2 }, tileComparePhoto: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#e7eee4', borderWidth: 1.5, borderColor: '#fff' }, tileComparePhotoEmpty: { alignItems: 'center', justifyContent: 'center' }, tileComparePhotoLabel: { color: '#788579', fontSize: 7.5, fontWeight: '600' }, tileMetricRow: { minHeight: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 5, marginBottom: 2, borderRadius: 7, backgroundColor: '#fff' }, tileMetricLabel: { flex: 1, color: '#667669', fontSize: 8, fontWeight: '600', textTransform: 'capitalize' }, tileMetricScores: { flexDirection: 'row', alignItems: 'center', gap: 3 }, tileMetricValue: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#f0f3ee' }, tileMetricValueFilled: { backgroundColor: '#eaf0e8' }, tileMetricToday: { backgroundColor: '#dcebd9' }, tileMetricValueText: { color: '#9aa49a', fontSize: 7, fontWeight: '600' }, tileMetricValueTextFilled: { color: '#3d6246', fontWeight: '700' }, tileMetricMoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1, paddingHorizontal: 4 }, tileMetricMore: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 7, color: '#4c6c52', backgroundColor: '#e8f0e6', fontSize: 7.5, fontWeight: '700' }, tileMetricMoreHint: { color: '#8a958b', fontSize: 7.5 },
  tileRoutine: { gap: 5, marginTop: 4 }, tileRoutineLine: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5 }, tileRoutineDot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, tileRoutineAm: { backgroundColor: '#f5efdf' }, tileRoutinePm: { backgroundColor: '#e9ecf3' }, tileRoutineCopy: { flex: 1, minWidth: 38 }, tileRoutineCount: { color: '#8a958b', fontSize: 8.5, marginTop: 1 }, tileRoutineStrong: { color: '#465a49', fontSize: 9.5, fontWeight: '700' }, tileRoutineProducts: { flexDirection: 'row', alignItems: 'center', marginLeft: 1 }, tileRoutineThumb: { width: 22, height: 32, alignItems: 'center', justifyContent: 'center', overflow: 'visible', borderRadius: 11, backgroundColor: '#f4f6f1', borderColor: '#fff', borderWidth: 1.5 }, tileRoutineThumbOverlap: { marginLeft: -7 }, tileRoutineProductImage: { width: 18, height: 29 }, tileRoutineMore: { color: '#68776d', fontSize: 8.5, fontWeight: '700', marginLeft: 2 },
  stickyProductSearch: { paddingTop: 10, paddingBottom: 8 }, productPicker: { padding: 10, marginTop: 10, borderRadius: 16, backgroundColor: '#f4f7f2', borderWidth: 1, borderColor: '#e8ede5' }, pickerSelectedBlock: { marginTop: 9, paddingHorizontal: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dde6db' }, selectedProductRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce4d9' }, removeSelectedButton: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#e9efe6' }, photoPickerTitle: { color: '#4c6351', fontSize: 11, fontWeight: '700', paddingHorizontal: 5, paddingBottom: 5 }, productSearch: { height: 41, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5ebe3' }, productSearchInput: { flex: 1, color: '#35463a', fontSize: 12 }, productSearchPrompt: { color: '#788679', fontSize: 10, lineHeight: 14, marginHorizontal: 4, marginTop: 9, marginBottom: 3 }, productSearchState: { marginVertical: 12 }, productSearchStateText: { color: '#89948a', fontSize: 10, padding: 10 }, productResult: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce4d9' }, productResultSelected: { backgroundColor: '#edf4eb' }, productResultCopy: { flex: 1, minWidth: 0 }, productResultBrand: { color: '#718072', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 }, productResultName: { color: '#405245', fontSize: 11.5, fontWeight: '600', marginTop: 2 }, productResultMeta: { color: '#849085', fontSize: 9, marginTop: 2 }, productResultAction: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e7efe5' }, productResultActionSelected: { backgroundColor: '#31543b' },
  sheetFooter: { paddingTop: 10 }, sheetPrivacy: { color: '#879287', textAlign: 'center', fontSize: 9, marginBottom: 9 }, doneButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#31543b' }, doneButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
