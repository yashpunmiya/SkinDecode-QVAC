import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useRoutine } from '../../../src/routine/RoutineProvider';
import { getRoutineProductSummaries } from '../../../src/products/catalog-service';
import { useProductSelection } from '../../../src/products/ProductSelectionProvider';
import type { ProductSummary } from '../../../src/products/types';
import { makeLocalId, WEEK_DAY_LABELS, WEEK_DAYS, type RoutineDraft, type RoutinePeriod, type RoutineStepDraft } from '../../../src/routine/models';

const templates = [
  { title: 'Cleanse / rinse', kind: 'cleanse', period: 'am' as const },
  { title: 'Cleanser', kind: 'cleanse', period: 'pm' as const },
  { title: 'Treatment', kind: 'treatment', period: 'pm' as const },
  { title: 'Moisturizer', kind: 'moisturizer', period: 'am' as const },
  { title: 'SPF', kind: 'spf', period: 'am' as const },
  { title: 'Custom step', kind: 'custom', period: 'am' as const },
];

function newStep(userId: string, title: string, kind: string, period: RoutinePeriod, position: number): RoutineStepDraft {
  return {
    id: makeLocalId('step', userId), title, kind, period,
    daysOfWeek: [...WEEK_DAYS], frequencyPerWeek: 7, notes: null, position, enabled: true,
    productId: null, shelfItemId: null, sourceScanId: null, recommendationId: null, ingredientContext: null,
    conflictRefs: [],
  };
}

export default function EditRoutineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string; shelfItemId?: string; productName?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { status, snapshot, activeRoutineId, saveDraft, isSaving } = useRoutine();
  const { registerRoutineProductListener } = useProductSelection();
  const [name, setName] = useState('My skincare routine');
  const [steps, setSteps] = useState<RoutineStepDraft[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [productSummaries, setProductSummaries] = useState<Record<string, ProductSummary>>({});
  const initializedRoutineId = useRef<string | null>(null);
  const prefilledProductKey = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    const initKey = `${userId}:${activeRoutineId}`;
    if (initializedRoutineId.current === initKey) return;
    const routine = snapshot.routines.find((row) => row.id === activeRoutineId);
    setName(routine?.name || 'My skincare routine');
    const loadedSteps = snapshot.steps
      .filter((step) => step.routineId === activeRoutineId)
      .sort((first, second) => first.position - second.position)
      .map(({ routineId: _routineId, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, cloudVersion: _cloudVersion, ...step }) => step);
    const requestedProductId = Number(params.productId);
    const hasNewProduct = Number.isSafeInteger(requestedProductId) && requestedProductId > 0 && Boolean(params.shelfItemId);
    const productKey = hasNewProduct ? `${requestedProductId}:${params.shelfItemId}` : null;
    if (hasNewProduct && productKey && prefilledProductKey.current !== productKey && !loadedSteps.some((step) => step.shelfItemId === params.shelfItemId)) {
      const productStep = newStep(userId, params.productName || 'Product', 'product', 'pm', loadedSteps.length);
      productStep.productId = null;
      productStep.shelfItemId = params.shelfItemId!;
      loadedSteps.push(productStep);
      setProductNames((current) => ({ ...current, [productStep.id]: params.productName || 'Product' }));
      prefilledProductKey.current = productKey;
    }
    setSteps(loadedSteps);
    initializedRoutineId.current = initKey;
    setLoaded(true);
  }, [activeRoutineId, snapshot.routines, snapshot.steps, status, userId, params.productId, params.shelfItemId, params.productName]);

  useEffect(() => registerRoutineProductListener((selection) => {
    setSteps((current) => current.map((step) => step.id === selection.stepId
      ? { ...step, productId: null, shelfItemId: selection.shelfItemId }
      : step));
    setProductNames((current) => ({ ...current, [selection.stepId]: selection.productName }));
  }), [registerRoutineProductListener]);

  const linkedProductsKey = useMemo(() => steps
    .filter((step) => step.productId !== null || step.shelfItemId !== null)
    .map((step) => `${step.id}:${step.productId ?? ''}:${step.shelfItemId ?? ''}`).join('|'), [steps]);

  useEffect(() => {
    if (!userId || !linkedProductsKey) return;
    let active = true;
    const linkedSteps = steps.filter((step) => step.productId !== null || step.shelfItemId !== null);
    void getRoutineProductSummaries(userId, linkedSteps).then((products) => {
      if (!active) return;
      setProductNames((current) => ({ ...current, ...Object.fromEntries([...products].map(([stepId, product]) => [stepId, product.name])) }));
      setProductSummaries(Object.fromEntries(products));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [linkedProductsKey, steps, userId]);

  const routineId = activeRoutineId || undefined;
  const visibleSteps = useMemo(() => steps, [steps]);

  const updateStep = (id: string, update: (step: RoutineStepDraft) => RoutineStepDraft) => {
    setSteps((current) => current.map((step) => step.id === id ? update(step) : step));
  };

  const toggleDay = (id: string, day: number) => {
    updateStep(id, (step) => {
      const daysOfWeek = step.daysOfWeek.includes(day)
        ? step.daysOfWeek.filter((value) => value !== day)
        : [...step.daysOfWeek, day].sort((a, b) => a - b);
      return { ...step, daysOfWeek, frequencyPerWeek: daysOfWeek.length };
    });
  };

  const chooseTemplate = (template: (typeof templates)[number]) => {
    if (!userId) return;
    setSteps((current) => [...current, newStep(userId, template.title, template.kind, template.period, current.length)]);
    setTemplatePickerOpen(false);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next.map((step, position) => ({ ...step, position }));
    });
  };

  const chooseProduct = (stepId: string) => router.push(`/products/search?mode=routine&stepId=${encodeURIComponent(stepId)}` as unknown as Href);

  const handleSave = async () => {
    setError(null);
    const activeSteps = steps.filter((step) => step.title.trim());
    if (!activeSteps.length) {
      setError('Add at least one step to your routine.');
      return;
    }
    if (activeSteps.some((step) => step.daysOfWeek.length === 0)) {
      setError('Choose at least one day for each step.');
      return;
    }
    const draft: RoutineDraft = {
      routineId,
      name: name.trim() || 'My skincare routine',
      steps: activeSteps.map((step, position) => ({ ...step, position, frequencyPerWeek: step.daysOfWeek.length })),
    };
    try {
      await saveDraft(draft);
      router.back();
    } catch {
      setError('The routine could not be saved on this device. Please try again.');
    }
  };

  if (status === 'loading' || !loaded) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close editor" style={styles.closeButton}>
              <Feather name="x" size={21} color="#26382d" />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
              <Text style={styles.title}>Edit routine</Text>
            </View>
          </View>

          <View style={styles.nameCard}>
            <Text style={styles.fieldLabel}>ROUTINE NAME</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="My skincare routine"
              placeholderTextColor="#a1aaa2"
              maxLength={48}
              style={styles.nameInput}
              accessibilityLabel="Routine name"
            />
          </View>

          <View style={styles.introRow}>
            <View>
              <Text style={styles.sectionTitle}>Your steps</Text>
              <Text style={styles.sectionBody}>Keep only what feels right for you.</Text>
            </View>
            <Text style={styles.stepCount}>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</Text>
          </View>

          {visibleSteps.map((step, index) => (
            <View key={step.id} style={styles.stepEditor}>
              <View style={styles.stepEditorTop}>
                <View style={styles.reorderButtons}>
                  <Pressable onPress={() => moveStep(index, -1)} disabled={index === 0} accessibilityLabel="Move step up" style={styles.reorderButton}>
                    <Feather name="chevron-up" size={16} color={index === 0 ? '#c5ccc5' : '#617467'} />
                  </Pressable>
                  <Pressable onPress={() => moveStep(index, 1)} disabled={index === steps.length - 1} accessibilityLabel="Move step down" style={styles.reorderButton}>
                    <Feather name="chevron-down" size={16} color={index === steps.length - 1 ? '#c5ccc5' : '#617467'} />
                  </Pressable>
                </View>
                <TextInput
                  value={step.title}
                  onChangeText={(title) => updateStep(step.id, (current) => ({ ...current, title }))}
                  placeholder="Step name"
                  placeholderTextColor="#a1aaa2"
                  maxLength={48}
                  style={styles.stepNameInput}
                  accessibilityLabel={`Step ${index + 1} name`}
                />
                <Pressable onPress={() => setSteps((current) => current.filter((item) => item.id !== step.id))} accessibilityRole="button" accessibilityLabel={`Remove ${step.title}`} style={styles.removeButton}>
                  <Feather name="trash-2" size={16} color="#a27c70" />
                </Pressable>
              </View>

              <View style={styles.periodRow}>
                <Text style={styles.fieldLabel}>WHEN</Text>
                <View style={styles.periodPills}>
                  {(['am', 'pm'] as const).map((period) => (
                    <Pressable
                      key={period}
                      accessibilityRole="button"
                      accessibilityState={{ selected: step.period === period }}
                      onPress={() => updateStep(step.id, (current) => ({ ...current, period }))}
                      style={[styles.periodPill, step.period === period && styles.periodPillActive]}
                    >
                      <Feather name={period === 'am' ? 'sun' : 'moon'} size={12} color={step.period === period ? '#fff' : '#829087'} />
                      <Text style={[styles.periodPillText, step.period === period && styles.periodPillTextActive]}>{period.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.productLinkRow}>
                <View style={styles.productLinkCopy}>
                  <Text style={styles.fieldLabel}>PRODUCT</Text>
                  <Pressable disabled={!productSummaries[step.id]} onPress={() => {
                    const product = productSummaries[step.id];
                    if (product) router.push({ pathname: '/products/[productId]', params: { productId: String(product.productId), ...(product.isLegacySnapshot ? { source: 'legacy' } : {}) } } as Href);
                  }} accessibilityRole={productSummaries[step.id] ? 'button' : undefined}>
                    <Text style={styles.productLinkName} numberOfLines={1}>
                    {productNames[step.id] || (step.productId !== null ? `Saved product #${step.productId}` : step.shelfItemId ? 'Saved product' : 'No product linked')}
                    </Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => chooseProduct(step.id)} style={styles.linkProductButton} accessibilityRole="button" accessibilityLabel={`${step.productId !== null || step.shelfItemId ? 'Change' : 'Link'} product for ${step.title}`}>
                  <Feather name={step.productId !== null || step.shelfItemId ? 'refresh-cw' : 'plus'} size={12} color="#45634c" />
                  <Text style={styles.linkProductText}>{step.productId !== null || step.shelfItemId ? 'Change' : 'Link product'}</Text>
                </Pressable>
                {step.productId !== null || step.shelfItemId ? <Pressable onPress={() => updateStep(step.id, (current) => ({ ...current, productId: null, shelfItemId: null }))} accessibilityRole="button" accessibilityLabel={`Unlink product from ${step.title}`} style={styles.unlinkButton}><Feather name="x" size={14} color="#8b756d" /></Pressable> : null}
              </View>

              <View style={styles.daysHeader}>
                <Text style={styles.fieldLabel}>DAYS</Text>
                <Text style={styles.frequency}>{step.frequencyPerWeek === 7 ? 'Every day' : `${step.frequencyPerWeek}× per week`}</Text>
              </View>
              <View style={styles.daysRow}>
                {WEEK_DAYS.map((day, dayIndex) => {
                  const selected = step.daysOfWeek.includes(day);
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={`${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}${selected ? ', selected' : ''}`}
                      accessibilityState={{ selected }}
                      onPress={() => toggleDay(step.id, day)}
                      style={[styles.dayChip, selected && styles.dayChipActive]}
                    >
                      <Text style={[styles.dayChipText, selected && styles.dayChipTextActive]}>{WEEK_DAY_LABELS[dayIndex]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, styles.notesLabel]}>NOTES · OPTIONAL</Text>
              <TextInput
                value={step.notes || ''}
                onChangeText={(notes) => updateStep(step.id, (current) => ({ ...current, notes: notes || null }))}
                placeholder="A reminder for future you"
                placeholderTextColor="#a1aaa2"
                multiline
                maxLength={240}
                style={styles.notesInput}
                accessibilityLabel={`Notes for ${step.title}`}
              />
            </View>
          ))}

          <Pressable onPress={() => setTemplatePickerOpen(true)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <View style={styles.addIcon}><Feather name="plus" size={17} color="#45634c" /></View>
            <Text style={styles.addText}>Add a step</Text>
            <Feather name="arrow-right" size={15} color="#78907c" />
          </Pressable>

          <View style={styles.infoRow}>
            <Feather name="shield" size={15} color="#7e967f" />
            <Text style={styles.infoText}>Your routine is private and follows your account across devices.</Text>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={() => void handleSave()} disabled={isSaving} style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}>
            {isSaving ? <Text style={styles.saveText}>Saving…</Text> : <><Text style={styles.saveText}>Save routine</Text><Feather name="check" size={17} color="#fff" /></>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={templatePickerOpen} transparent animationType="slide" onRequestClose={() => setTemplatePickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTemplatePickerOpen(false)} accessibilityLabel="Close step picker" />
          <View style={styles.templateSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Add to your routine</Text>
            <Text style={styles.sheetSubtitle}>Choose a familiar step or make your own.</Text>
            {templates.map((template) => (
              <Pressable key={`${template.kind}-${template.title}-${template.period}`} onPress={() => chooseTemplate(template)} style={styles.templateOption}>
                <View style={styles.templateIcon}>
                  <Feather name={template.period === 'am' ? 'sun' : 'moon'} size={15} color="#536e59" />
                </View>
                <Text style={styles.templateTitle}>{template.title}</Text>
                <Text style={styles.templatePeriod}>{template.period.toUpperCase()}</Text>
                <Feather name="plus" size={17} color="#74877a" />
              </Pressable>
            ))}
            <Pressable onPress={() => setTemplatePickerOpen(false)} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  content: { paddingHorizontal: 21, paddingBottom: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 7, marginBottom: 20 },
  closeButton: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#849187', fontSize: 9, fontWeight: '700', letterSpacing: 1.55 },
  title: { color: '#203329', fontSize: 27, lineHeight: 31, fontFamily: 'Georgia', fontWeight: '700' },
  nameCard: { paddingHorizontal: 15, paddingTop: 13, paddingBottom: 10, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  fieldLabel: { color: '#8b958d', fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  nameInput: { padding: 0, marginTop: 7, color: '#25372c', fontSize: 15, fontWeight: '600' },
  introRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24, marginBottom: 11 },
  sectionTitle: { color: '#26382d', fontSize: 18, fontWeight: '700' },
  sectionBody: { color: '#879189', fontSize: 11.5, marginTop: 3 },
  stepCount: { color: '#77857a', fontSize: 10.5, fontWeight: '600', paddingBottom: 3 },
  stepEditor: { padding: 14, marginBottom: 10, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  stepEditorTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reorderButtons: { gap: 1 },
  reorderButton: { width: 22, height: 19, alignItems: 'center', justifyContent: 'center' },
  stepNameInput: { flex: 1, minWidth: 0, padding: 0, color: '#26382d', fontSize: 14, fontWeight: '700' },
  removeButton: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#faf4f1' },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  productLinkRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, paddingHorizontal: 10, borderRadius: 13, backgroundColor: '#f6f8f4' },
  productLinkCopy: { flex: 1, minWidth: 0 },
  productLinkName: { color: '#44584a', fontSize: 10.5, fontWeight: '600', marginTop: 3 },
  linkProductButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 11, backgroundColor: '#e8f0e8' },
  linkProductText: { color: '#45634c', fontSize: 9.5, fontWeight: '700' },
  unlinkButton: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center' },
  periodPills: { flexDirection: 'row', gap: 5 },
  periodPill: { minWidth: 52, height: 28, paddingHorizontal: 8, gap: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f3f5f1' },
  periodPillActive: { backgroundColor: '#47684e' },
  periodPillText: { color: '#849087', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  periodPillTextActive: { color: '#fff' },
  daysHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13, marginBottom: 7 },
  frequency: { color: '#879189', fontSize: 10 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 5 },
  dayChip: { flex: 1, aspectRatio: 1, maxWidth: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f5f2' },
  dayChipActive: { backgroundColor: '#e8f0e8', borderWidth: 1, borderColor: '#cbdacb' },
  dayChipText: { color: '#98a199', fontSize: 10, fontWeight: '600' },
  dayChipTextActive: { color: '#426249', fontWeight: '700' },
  notesLabel: { marginTop: 13, marginBottom: 6 },
  notesInput: { minHeight: 38, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11, backgroundColor: '#f8f9f6', color: '#46574a', fontSize: 11.5, lineHeight: 16 },
  addButton: { minHeight: 54, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cdd7cd', backgroundColor: '#fafbf9' },
  addIcon: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eaf1e9' },
  addText: { flex: 1, color: '#4b6651', fontSize: 12, fontWeight: '700' },
  infoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingTop: 16, paddingBottom: 5 },
  infoText: { color: '#8b958d', fontSize: 10, flexShrink: 1 },
  errorText: { color: '#a64d3d', fontSize: 11.5, marginTop: 7, marginBottom: 3 },
  footer: { paddingHorizontal: 21, paddingTop: 10, paddingBottom: 6, backgroundColor: '#f6f6f2' },
  saveButton: { minHeight: 52, borderRadius: 17, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#31543b' },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(29, 42, 33, 0.28)' },
  templateSheet: { paddingHorizontal: 21, paddingTop: 11, paddingBottom: 30, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#f8f8f5' },
  sheetHandle: { alignSelf: 'center', width: 35, height: 4, borderRadius: 2, backgroundColor: '#d4d9d2', marginBottom: 17 },
  sheetTitle: { color: '#24372a', fontFamily: 'Georgia', fontSize: 21, fontWeight: '700' },
  sheetSubtitle: { color: '#808b82', fontSize: 12, marginTop: 4, marginBottom: 13 },
  templateOption: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e7eae4' },
  templateIcon: { width: 31, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eaf1e9' },
  templateTitle: { flex: 1, color: '#33453a', fontSize: 12.5, fontWeight: '600' },
  templatePeriod: { color: '#8b968d', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  cancelButton: { alignItems: 'center', paddingVertical: 13, marginTop: 8 },
  cancelText: { color: '#7d8980', fontSize: 12, fontWeight: '600' },
});
