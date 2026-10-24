import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { addProductToShelf, getProductDetail, getShelfItemForProduct, getSkinProfile, removeShelfItem } from '../../../src/products/catalog-service';
import { scoreProductMatch, type IntelligenceEvidence } from '../../../src/products/product-intelligence';
import { skinAIHref } from '../../../src/skin-ai/navigation';
import type { ProductDetail, ProductFormula, SkinProfile } from '../../../src/products/types';

export default function ProductDetailScreen() {
  const router = useRouter();
  const { productId: rawProductId, source } = useLocalSearchParams<{ productId: string; source?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const productId = /^\d+$/.test(String(rawProductId || '')) ? Number(rawProductId) : NaN;
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [formulaId, setFormulaId] = useState<number | null>(null);
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [shelfItemId, setShelfItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [showAllIngredients, setShowAllIngredients] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      setError('This product link is not valid.'); setLoading(false); return;
    }
    setLoading(true); setOffline(false); setCached(false); setError(null);
    try {
      const result = await getProductDetail(productId, source === 'legacy');
      setProduct(result.product); setOffline(result.offline); setCached(result.cached);
      setFormulaId(result.product?.formulas[0]?.id ?? null);
      if (!result.product) setError(result.offline ? 'Connect to the internet to load this product.' : 'This product could not be found in the catalog.');
    } catch (loadError) {
      setOffline(false);
      setError(loadError instanceof Error ? loadError.message : 'Product details could not be loaded. Please try again.');
    } finally { setLoading(false); }
  }, [productId, source]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setImageFailed(false); }, [product?.imageUrl]);
  useEffect(() => { setShowAllIngredients(false); }, [formulaId]);

  useEffect(() => {
    let active = true;
    setProfile(null); setShelfItemId(null);
    if (!userId || !Number.isSafeInteger(productId) || source === 'legacy') return () => { active = false; };
    void Promise.all([
      getSkinProfile(userId).catch(() => null),
      getShelfItemForProduct(userId, productId).catch(() => null),
    ]).then(([row, shelf]) => {
      if (!active) return;
      if (row?.onboarding_completed) setProfile({
        ageRange: row.age_range, skinType: row.skin_type, sensitivity: row.sensitivity,
        concerns: row.skin_concerns || [], goals: row.skin_goals || [], preferences: row.preferences || [],
      });
      setShelfItemId(shelf?.id || null);
    });
    return () => { active = false; };
  }, [productId, source, userId]);

  const formula = useMemo(() => product?.formulas.find((candidate) => candidate.id === formulaId) || product?.formulas[0] || null, [formulaId, product]);
  const intelligence = useMemo(() => profile && product ? scoreProductMatch(product, profile, formula) : null, [formula, product, profile]);
  // Guard the view against stale or partially shaped cached intelligence data.
  const matchedConcerns = Array.isArray(intelligence?.matchedConcerns) ? intelligence.matchedConcerns : [];
  const matchedGoals = Array.isArray(intelligence?.matchedGoals) ? intelligence.matchedGoals : [];
  const positiveEvidence = uniqueEvidenceRows(intelligence?.strongestPositives);
  const concernEvidence = uniqueEvidenceRows(intelligence?.strongestConcerns);
  const preferenceEvidence = Array.isArray(intelligence?.preferenceResults) ? intelligence.preferenceResults.filter(Boolean) : [];
  const dataLimitations = Array.isArray(intelligence?.dataLimitations) ? intelligence.dataLimitations : [];

  const benefits = formula?.analysis.filter((item) => item.kind === 'benefit' && item.resolved) || [];
  const concerns = formula?.analysis.filter((item) => item.kind === 'concern' && item.resolved) || [];
  const pendingAnalysis = formula?.analysis.filter((item) => !item.resolved) || [];

  const toggleShelf = async () => {
    if (!userId || !product || product.isLegacySnapshot || busy) return;
    setBusy(true); setActionError(null);
    try {
      if (shelfItemId) {
        await removeShelfItem(userId, shelfItemId);
        setShelfItemId(null);
      } else {
        const item = await addProductToShelf(userId, product.productId);
        setShelfItemId(item.id);
      }
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'The shelf could not be updated. Please retry.');
    } finally { setBusy(false); }
  };

  const useInRoutine = async () => {
    if (!userId || !product || product.isLegacySnapshot || busy) return;
    setBusy(true); setActionError(null);
    try {
      const item = shelfItemId ? { id: shelfItemId } : await addProductToShelf(userId, product.productId);
      setShelfItemId(item.id);
      router.push({ pathname: '/routine/edit', params: { productId: String(product.productId), shelfItemId: item.id, productName: product.name } } as Href);
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'This product could not be added to your routine.');
    } finally { setBusy(false); }
  };

  const openIngredient = (ingredientId: number | null) => {
    if (ingredientId !== null) router.push(`/ingredients/${ingredientId}` as Href);
  };

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}><Feather name="arrow-left" size={19} color="#24432f" /></Pressable>
          <View style={styles.topCopy}><Text style={styles.topEyebrow}>SKINDECODE CATALOG</Text><Text style={styles.topTitle}>Product details</Text></View>
          <View style={styles.topSpacer} />
        </View>
        {loading ? <View style={styles.center}><View style={styles.heroSkeleton} /><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /><ActivityIndicator color="#31543b" style={{ marginTop: 12 }} /><Text style={styles.body}>Gathering formula details…</Text></View> : null}
        {!loading && error ? <View style={styles.center}><View style={styles.errorIcon}><Feather name={offline ? 'wifi-off' : 'alert-circle'} size={21} color="#54735a" /></View><Text style={styles.heading}>{offline ? 'Product unavailable offline' : 'Could not open product'}</Text><Text style={styles.body}>{error}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
        {!loading && product ? (
          <>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {product.isLegacySnapshot ? <View style={styles.legacyBanner}><Feather name="archive" size={13} color="#806c50" /><Text style={styles.legacyText}>Archived product snapshot · its original catalog identity is preserved.</Text></View> : null}
              {offline || cached ? <View style={[styles.cacheBanner, offline && styles.offlineBanner]}><Feather name={offline ? 'wifi-off' : 'check-circle'} size={13} color={offline ? '#806c50' : '#55725a'} /><Text style={[styles.cacheText, offline && styles.offlineText]}>{offline ? 'Offline · showing saved catalog details' : 'Saved for quick access'}</Text></View> : null}
              <View style={styles.productHero}>
                {product.imageUrl && !imageFailed ? <Image source={{ uri: product.imageUrl }} onError={() => setImageFailed(true)} style={styles.productImage} resizeMode="contain" /> : <View style={[styles.productImage, styles.imageFallback]}><Feather name="droplet" size={37} color="#68836b" /></View>}
                <Text style={styles.brand}>{product.brand}</Text>
                <Text style={styles.name}>{product.name}</Text>
                <Text style={styles.category}>{[product.category, product.subcategory, product.quantity].filter(Boolean).join(' · ') || 'Skincare product'}</Text>
                {product.barcode ? <Text style={styles.legacyMeta}>Barcode · {product.barcode}</Text> : null}
                {product.description ? <Text style={styles.description}>{product.description}</Text> : null}
              </View>

              {product.formulas.length > 1 ? <View style={styles.formulaSection}>
                <View style={styles.sectionHeader}><View><Text style={styles.sectionEyebrow}>FORMULA OPTIONS</Text><Text style={styles.sectionTitle}>Choose a version</Text></View><Feather name="layers" size={17} color="#5c7a60" /></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formulaPills}>
                  {product.formulas.map((option, index) => <Pressable key={option.id} onPress={() => setFormulaId(option.id)} accessibilityRole="button" accessibilityState={{ selected: formula?.id === option.id }} style={[styles.formulaPill, formula?.id === option.id && styles.formulaPillActive]}><Text style={[styles.formulaPillText, formula?.id === option.id && styles.formulaPillTextActive]}>{formulaTitle(option, index)}</Text></Pressable>)}
                </ScrollView>
              </View> : null}

              {formula ? <View style={styles.formulaMeta}><Feather name="globe" size={14} color="#66806b" /><Text style={styles.formulaMetaText}>{[formula.variant, formula.formulation, formula.region].filter(Boolean).join(' · ') || `Formula ${product.formulas.indexOf(formula) + 1}`}</Text></View> : null}

              {formula?.flags.length ? <View style={styles.flagsRow}>{formula.flags.map((flag) => <View key={flag.id} style={styles.flagChip}><Feather name="check-circle" size={11} color="#477451" /><Text style={styles.flagText}>{flag.label}</Text></View>)}</View> : null}

              {profile ? <View style={styles.profileCard}>
                <View style={styles.profileHeader}><View style={styles.profileIcon}><Feather name="user-check" size={15} color="#fff" /></View><View style={styles.profileCopy}><Text style={styles.profileEyebrow}>FOR YOUR SKIN</Text><Text style={styles.profileTitle}>Skin Match</Text></View><View style={styles.scorePill}><Text style={styles.scoreValue}>{intelligence?.score ?? '—'}</Text>{intelligence?.score !== null && intelligence?.score !== undefined ? <Text style={styles.scoreSuffix}>/100</Text> : null}</View></View>
                <Text style={styles.scoreContext}>{intelligence?.score === null || intelligence?.score === undefined ? 'Not enough data for a reliable Skin Match' : `${intelligence.matchLevel} · ${intelligence.confidence} confidence`}</Text>
                <View style={styles.subScores}>
                  {([
                    ['skin_type', 'Skin type'], ['concerns', 'Concerns'], ['goals', 'Goals'], ['sensitivity', 'Sensitivity'], ['preferences', 'Preferences'],
                  ] as const).filter(([key]) => (intelligence?.subScores[key] ?? 0) > 0).map(([key, label]) => <View key={key} style={styles.subScoreRow}><Text style={styles.subScoreLabel}>{label}</Text><Text style={styles.subScoreValue}>{intelligence!.subScores[key]}/100</Text></View>)}
                </View>
                {matchedConcerns.length ? <Text style={styles.matchedTopics}>Concern matches · {matchedConcerns.join(', ').replaceAll('_', ' ')}</Text> : null}
                {matchedGoals.length ? <Text style={styles.matchedTopics}>Goal matches · {matchedGoals.join(', ').replaceAll('_', ' ')}</Text> : null}
                {positiveEvidence.map((item, index) => <View key={`positive-${item?.key || index}-${index}`} style={styles.profileSignal}><Feather name="check-circle" size={13} color="#477451" /><View style={styles.signalCopy}><Text style={styles.signalTitle}>{item?.label || 'Skin profile benefit'}</Text><Text style={styles.signalText}>{ingredientSummary(item?.ingredientNames, item?.key)}</Text></View></View>)}
                {concernEvidence.map((item, index) => <View key={`concern-${item?.key || index}-${index}`} style={styles.profileSignal}><Feather name="alert-circle" size={13} color="#96775a" /><View style={styles.signalCopy}><Text style={styles.signalTitle}>{item?.label || 'Skin profile concern'}</Text><Text style={styles.signalText}>{ingredientSummary(item?.ingredientNames, item?.key)}</Text></View></View>)}
                {preferenceEvidence.filter((item) => item.status !== 'unknown').map((item, index) => <View key={`preference-${item.preference || index}`} style={styles.profileSignal}><Feather name={item.status === 'match' ? 'check-circle' : 'alert-circle'} size={13} color={item.status === 'match' ? '#477451' : '#96775a'} /><View style={styles.signalCopy}><Text style={styles.signalTitle}>{String(item.preference || 'Preference').replaceAll('_', ' ')} · {item.status}</Text><Text style={styles.signalText}>{(Array.isArray(item.evidence) ? item.evidence : []).map((key) => String(key).replaceAll('_', ' ')).join(', ')}</Text></View></View>)}
                {positiveEvidence.length === 0 && concernEvidence.length === 0 ? <Text style={styles.profileNote}>No mapped product evidence is available for your profile yet.</Text> : null}
                {dataLimitations.map((item, index) => <Text key={`${String(item)}-${index}`} style={styles.profileNote}>{String(item)}</Text>)}
                {intelligence?.coverage ? <Text style={styles.coverageNote}>{intelligence.coverage.supportedDimensions} of {intelligence.coverage.activeDimensions} selected dimensions have catalog evidence · {intelligence.coverage.exactSignals} exact signals · {intelligence.coverage.genericSignals} supporting ingredient attributes</Text> : null}
                <Text style={styles.disclaimer}>Exact linked formula evidence carries the most weight. Ingredient attributes are supporting evidence, and list position is only a small tie-breaker. This is not a medical assessment.</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push(skinAIHref({ type: 'product', id: product.productId, label: `${product.brand} · ${product.name}` }))} style={({ pressed }) => [styles.askAIButton, pressed && styles.pressed]}><Feather name="message-circle" size={14} color="#31543b" /><Text style={styles.askAIText}>Ask Skin AI about this product</Text><Feather name="arrow-up-right" size={13} color="#65806a" /></Pressable>
              </View> : null}

              {benefits.length ? <AnalysisSection title="Potential benefits" eyebrow="CATALOG ANALYSIS" icon="sun" items={benefits} onIngredientPress={openIngredient} kind="benefit" /> : null}
              {concerns.length ? <AnalysisSection title="Potential concerns" eyebrow="CATALOG ANALYSIS" icon="alert-triangle" items={concerns} onIngredientPress={openIngredient} kind="concern" /> : null}
              {pendingAnalysis.length ? <View style={styles.pendingSection}>
                <Text style={styles.pendingHeading}>Signals still under review</Text>
                <Text style={styles.pendingIntro}>These catalog relationships are incomplete, so they are shown as source data rather than product claims.</Text>
                {pendingAnalysis.map((item, index) => <View key={`pending-${item.attributeId}-${item.stateId}-${index}`} style={styles.pendingCard}>
                  <Feather name="info" size={14} color="#7c8066" />
                  <View style={styles.pendingCopy}>
                    <Text style={styles.pendingTitle}>{item.label}</Text>
                    <Text style={styles.pendingText}>{item.state.replaceAll('_', ' ')}{item.reportedCount !== null ? ` · ${item.reportedCount} reported` : ''}</Text>
                    {item.responsibleIngredients.length ? <View style={styles.responsibleChips}>{item.responsibleIngredients.map((ingredient, ingredientIndex) => <Pressable key={`pending-ing-${ingredient.id}-${ingredientIndex}`} onPress={() => openIngredient(ingredient.id)} disabled={ingredient.id === null} style={styles.responsibleChip}><Text style={styles.responsibleText}>{ingredient.inciName || ingredient.name}</Text></Pressable>)}</View> : null}
                  </View>
                </View>)}
              </View> : null}

              <View style={styles.sectionHeader}><View><Text style={styles.sectionEyebrow}>FORMULA BREAKDOWN</Text><Text style={styles.sectionTitle}>Ingredients{formula?.ingredients.length ? ` · ${formula.ingredients.length}` : ''}</Text></View><Feather name="list" size={18} color="#66806b" /></View>
              {formula?.ingredients.length ? <View style={styles.ingredientsCard}>
                {formula.ingredients.slice(0, showAllIngredients ? undefined : 5).map((ingredient, index) => <Pressable key={`${formula.id}-${ingredient.position}-${ingredient.id ?? index}`} disabled={ingredient.id === null} onPress={() => openIngredient(ingredient.id)} accessibilityRole={ingredient.id === null ? undefined : 'button'} style={[styles.ingredientRow, index > 0 && styles.ingredientBorder]}>
                  <Text style={styles.position}>{String(index + 1).padStart(2, '0')}</Text><View style={styles.ingredientCopy}><Text style={styles.ingredientName}>{ingredient.inciName || ingredient.name}</Text>{ingredient.functions.length ? <Text style={styles.ingredientMeta} numberOfLines={1}>{ingredient.functions.join(', ')}</Text> : null}</View>{ingredient.id !== null ? <Feather name="chevron-right" size={15} color="#a0aca1" /> : null}
                </Pressable>)}
                {formula.ingredients.length > 5 ? <Pressable onPress={() => setShowAllIngredients((current) => !current)} accessibilityRole="button" style={styles.readMoreButton}><Text style={styles.readMoreText}>{showAllIngredients ? 'Show less' : `Read more · ${formula.ingredients.length - 5} more`}</Text><Feather name={showAllIngredients ? 'chevron-up' : 'chevron-down'} size={14} color="#55765b" /></Pressable> : null}
                <Text style={styles.formulaFootnote}>Listed in the order recorded for this formula. Tap an ingredient to see its properties and sources.</Text>
              </View> : <View style={styles.noFormulaCard}><View style={styles.noFormulaIcon}><Feather name="file-text" size={17} color="#68806b" /></View><Text style={styles.noFormulaTitle}>{product.isLegacySnapshot ? 'Archived ingredient text' : 'No parsed ingredient list'}</Text><Text style={styles.body}>{product.isLegacySnapshot ? 'This saved routine product comes from the previous catalog. It is preserved as a snapshot and is not matched to a new catalog product.' : 'This is a valid catalog product. An ordered ingredient list has not been supplied for the selected formula.'}</Text>{product.rawIngredientText ? <Text style={styles.rawText}>{product.rawIngredientText}</Text> : null}</View>}

              {formula?.decodeWarnings.length ? <View style={styles.pendingCard}><Feather name="alert-circle" size={15} color="#8a7958" /><Text style={styles.pendingText}>Some stored formula details could not be decoded. The available product information is still shown.</Text></View> : null}
              {actionError ? <Text style={styles.actionError} accessibilityRole="alert">{actionError}</Text> : null}
            </ScrollView>
            {!product.isLegacySnapshot ? <View style={styles.footer}>
              <Pressable onPress={() => void toggleShelf()} disabled={busy || !userId} style={({ pressed }) => [styles.secondaryButton, pressed && !busy && styles.pressed, busy && styles.buttonDisabled]}>{busy ? <ActivityIndicator size="small" color="#31543b" /> : <Feather name={shelfItemId ? 'bookmark' : 'bookmark'} size={15} color="#31543b" />}<Text style={styles.secondaryButtonText}>{shelfItemId ? 'On shelf' : 'Save'}</Text></Pressable>
              <Pressable onPress={() => void useInRoutine()} disabled={busy || !userId} style={({ pressed }) => [styles.primaryButton, pressed && !busy && styles.pressed, busy && styles.buttonDisabled]}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="plus" size={16} color="#fff" /><Text style={styles.primaryButtonText}>Use in routine</Text></>}</Pressable>
            </View> : null}
          </>
        ) : null}
      </SafeAreaView>
    </TabScreenTransition>
  );
}

function ingredientSummary(value: unknown, key: unknown) {
  const ingredientNames = Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : [];
  return ingredientNames.join(', ') || String(key || 'profile evidence').replaceAll('_', ' ');
}

function uniqueEvidenceRows(value: unknown): IntelligenceEvidence[] {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, IntelligenceEvidence>();
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Partial<IntelligenceEvidence>;
    const key = typeof item.key === 'string' ? item.key : `evidence-${index}`;
    const previous = grouped.get(key);
    const names = Array.isArray(item.ingredientNames) ? item.ingredientNames.filter((name): name is string => typeof name === 'string') : [];
    const ids = Array.isArray(item.ingredientIds) ? item.ingredientIds.filter((id): id is number => typeof id === 'number') : [];
    const positions = Array.isArray(item.positions) ? item.positions.filter((position): position is number => typeof position === 'number') : [];
    const options = Array.isArray(item.matchedProfileOptions) ? item.matchedProfileOptions.filter((option): option is string => typeof option === 'string') : [];
    if (!previous) {
      grouped.set(key, {
        ...(item as IntelligenceEvidence),
        key,
        ingredientNames: [...new Set(names)],
        ingredientIds: [...new Set(ids)],
        positions: [...new Set(positions)],
        matchedProfileOptions: [...new Set(options)],
      });
      return;
    }
    grouped.set(key, {
      ...previous,
      ingredientNames: [...new Set([...previous.ingredientNames, ...names])],
      ingredientIds: [...new Set([...previous.ingredientIds, ...ids])],
      positions: [...new Set([...previous.positions, ...positions])],
      matchedProfileOptions: [...new Set([...previous.matchedProfileOptions, ...options])],
      points: Math.abs(item.points || 0) > Math.abs(previous.points) ? item.points! : previous.points,
    });
  });
  return [...grouped.values()];
}

function formulaTitle(formula: ProductFormula, index: number) {
  return [formula.variant, formula.formulation, formula.region].filter(Boolean).join(' · ') || `Formula ${index + 1}`;
}

function AnalysisSection({ title, eyebrow, icon, items, onIngredientPress, kind }: {
  title: string; eyebrow: string; icon: 'sun' | 'alert-triangle'; items: ProductFormula['analysis']; onIngredientPress: (id: number | null) => void; kind: 'benefit' | 'concern';
}) {
  const [selectedItem, setSelectedItem] = useState<ProductFormula['analysis'][number] | null>(null);
  const [showAllLinkedIngredients, setShowAllLinkedIngredients] = useState(false);
  const linkedIngredients = selectedItem?.responsibleIngredients || [];
  const visibleIngredients = showAllLinkedIngredients ? linkedIngredients : linkedIngredients.slice(0, 5);
  const linkedCount = selectedItem ? new Set(selectedItem.responsibleIngredients.map((ingredient) => ingredient.id === null ? `position:${ingredient.position}` : `id:${ingredient.id}`)).size : 0;

  const openDetails = (item: ProductFormula['analysis'][number]) => {
    setSelectedItem(item);
    setShowAllLinkedIngredients(false);
  };

  return <View style={styles.analysisSection}>
    <View style={styles.sectionHeader}><View><Text style={styles.sectionEyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View><Feather name={icon} size={17} color={kind === 'benefit' ? '#5b815e' : '#9b795c'} /></View>
    {items.map((item, index) => {
      const count = new Set(item.responsibleIngredients.map((ingredient) => ingredient.id === null ? `position:${ingredient.position}` : `id:${ingredient.id}`)).size;
      return <Pressable key={`${item.attributeId}-${item.stateId}-${index}`} onPress={() => openDetails(item)} accessibilityRole="button" accessibilityLabel={`${item.label}, ${count} linked ingredients`} style={[styles.analysisRow, kind === 'concern' && styles.concernAnalysisRow]}>
        <View style={styles.analysisRowCopy}><Text style={styles.analysisTitle} numberOfLines={2}>{item.label}</Text></View>
        <Text style={styles.analysisCount}>{count} {count === 1 ? 'ingredient' : 'ingredients'}</Text>
        <Feather name="chevron-right" size={16} color={kind === 'benefit' ? '#66836b' : '#9b795c'} />
      </Pressable>;
    })}
    <Modal visible={selectedItem !== null} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedItem(null)} accessibilityRole="button" accessibilityLabel="Close details" />
        <View style={styles.analysisModal}>
          <View style={styles.modalHeader}>
            <View style={[styles.modalIcon, kind === 'concern' && styles.concernModalIcon]}><Feather name={icon} size={16} color={kind === 'benefit' ? '#55765b' : '#9b795c'} /></View>
            <Pressable onPress={() => setSelectedItem(null)} accessibilityRole="button" accessibilityLabel="Close details" style={styles.modalClose}><Feather name="x" size={17} color="#657668" /></Pressable>
          </View>
          <Text style={styles.modalTitle}>{selectedItem?.label}</Text>
          {selectedItem?.description ? <Text style={styles.modalDescription}>{selectedItem.description}</Text> : null}
          <Text style={styles.modalEyebrow}>LINKED INGREDIENTS · {linkedCount}</Text>
          <ScrollView style={styles.modalIngredientList} showsVerticalScrollIndicator={false}>
            {visibleIngredients.length ? <View style={styles.responsibleChips}>{visibleIngredients.map((ingredient, ingredientIndex) => <Pressable key={`${ingredient.id}-${ingredient.position}-${ingredientIndex}`} onPress={() => { setSelectedItem(null); onIngredientPress(ingredient.id); }} disabled={ingredient.id === null} style={styles.responsibleChip}><Text style={styles.responsibleText}>{ingredient.inciName || ingredient.name}</Text></Pressable>)}</View> : <Text style={styles.noLinkedIngredients}>No individual ingredients are linked to this catalog signal.</Text>}
            {linkedIngredients.length > 5 ? <Pressable onPress={() => setShowAllLinkedIngredients((current) => !current)} accessibilityRole="button" style={styles.readMoreButton}><Text style={styles.readMoreText}>{showAllLinkedIngredients ? 'Show fewer ingredients' : `Read more · ${linkedIngredients.length - 5} more`}</Text><Feather name={showAllLinkedIngredients ? 'chevron-up' : 'chevron-down'} size={14} color="#55765b" /></Pressable> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f7f2' },
  topBar: { height: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1e9df' },
  topCopy: { flex: 1 }, topEyebrow: { color: '#718774', fontSize: 8, fontWeight: '700', letterSpacing: 1.3 },
  topTitle: { color: '#35543a', fontSize: 12, fontWeight: '700', marginTop: 2 }, topSpacer: { width: 38 },
  content: { paddingHorizontal: 18, paddingBottom: 23 },
  productHero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 23, borderRadius: 25, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1', shadowColor: '#294b35', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.045, shadowRadius: 12, elevation: 2 },
  productImage: { width: 176, height: 176, borderRadius: 25, backgroundColor: '#f0f5ee', marginBottom: 17 },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#64806a', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' },
  name: { color: '#1e3c29', fontFamily: 'Georgia', fontSize: 23, lineHeight: 29, textAlign: 'center', marginTop: 5 },
  category: { color: '#728276', fontSize: 11, marginTop: 6, textAlign: 'center' },
  description: { color: '#718075', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 13 },
  formulaSection: { marginTop: 22 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 23, marginBottom: 10, paddingHorizontal: 2 },
  sectionEyebrow: { color: '#758a77', fontSize: 8, fontWeight: '700', letterSpacing: 1.3 },
  sectionTitle: { color: '#284330', fontSize: 17, fontWeight: '700', marginTop: 3 },
  formulaPills: { gap: 7, paddingBottom: 3 },
  formulaPill: { minHeight: 35, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#edf3eb', borderWidth: 1, borderColor: '#e2ebdf' },
  formulaPillActive: { backgroundColor: '#31543b', borderColor: '#31543b' },
  formulaPillText: { color: '#526b56', fontSize: 10, fontWeight: '600' }, formulaPillTextActive: { color: '#fff' },
  formulaMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, paddingHorizontal: 4 },
  formulaMetaText: { color: '#728276', fontSize: 10.5 },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  flagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: '#eaf3e9' },
  flagText: { color: '#456a4a', fontSize: 9, fontWeight: '700' },
  profileCard: { marginTop: 20, padding: 14, borderRadius: 19, backgroundColor: '#e7f0e5', borderWidth: 1, borderColor: '#d6e5d4' },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 7 },
  profileIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#31543b' },
  profileCopy: { flex: 1 }, profileEyebrow: { color: '#68836a', fontSize: 7.5, fontWeight: '700', letterSpacing: 1.2 },
  profileTitle: { color: '#29432f', fontSize: 12.5, fontWeight: '700', marginTop: 2 },
  profileSignal: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d2e2cf' },
  scorePill: { minWidth: 58, minHeight: 36, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#fff' },
  scoreValue: { color: '#31543b', fontSize: 17, fontWeight: '800' }, scoreSuffix: { color: '#809080', fontSize: 8, fontWeight: '700' },
  scoreContext: { color: '#718075', fontSize: 9.5, marginBottom: 8, paddingLeft: 39, textTransform: 'capitalize' },
  subScores: { marginLeft: 39, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 13, backgroundColor: '#f6f8f4' },
  subScoreRow: { minHeight: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e6ece4' },
  subScoreLabel: { color: '#68796b', fontSize: 9.5 }, subScoreValue: { color: '#395b40', fontSize: 9.5, fontWeight: '700' },
  matchedTopics: { color: '#58745e', fontSize: 9.5, lineHeight: 14, marginBottom: 3, paddingLeft: 39, textTransform: 'capitalize' },
  signalCopy: { flex: 1 }, signalTitle: { color: '#435e47', fontSize: 10.5, fontWeight: '700' }, signalText: { color: '#718075', fontSize: 9.5, marginTop: 2 },
  profileNote: { color: '#657566', fontSize: 10.5, lineHeight: 15, paddingTop: 4 },
  coverageNote: { color: '#748176', fontSize: 8.5, lineHeight: 13, marginLeft: 39, marginTop: 4 },
  disclaimer: { color: '#829084', fontSize: 8.5, lineHeight: 13, marginTop: 9 },
  askAIButton: { minHeight: 37, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 11, paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#f8fbf6', borderWidth: 1, borderColor: '#d8e5d7' },
  askAIText: { color: '#42634a', fontSize: 10, fontWeight: '700' },
  analysisSection: { marginTop: 1 },
  analysisRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 15, backgroundColor: '#edf5eb', borderWidth: 1, borderColor: '#dfeade', marginBottom: 7 },
  concernAnalysisRow: { backgroundColor: '#f7f1e9', borderColor: '#eee3d5' },
  analysisRowCopy: { flex: 1 }, analysisCount: { color: '#728374', fontSize: 8.5, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.78)' },
  analysisTitle: { color: '#38563c', fontSize: 12, fontWeight: '700' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, backgroundColor: 'rgba(22, 38, 27, 0.38)' },
  analysisModal: { width: '100%', maxHeight: '72%', padding: 18, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf5eb' },
  concernModalIcon: { backgroundColor: '#f7f1e9' }, modalClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#f4f6f2' },
  modalTitle: { color: '#294330', fontSize: 18, lineHeight: 24, fontWeight: '700' },
  modalDescription: { color: '#718075', fontSize: 11, lineHeight: 17, marginTop: 7 },
  modalEyebrow: { color: '#849086', fontSize: 8, fontWeight: '700', letterSpacing: 0.8, marginTop: 17, marginBottom: 8 },
  modalIngredientList: { flexGrow: 0, maxHeight: 260 },
  readMoreButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e7ede5' },
  readMoreText: { color: '#55765b', fontSize: 10, fontWeight: '700' },
  responsibleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  responsibleChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: '#fff' }, responsibleText: { color: '#506d53', fontSize: 9, fontWeight: '600' },
  noLinkedIngredients: { color: '#8c897a', fontSize: 9.5, marginTop: 7 },
  pendingCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 13, backgroundColor: '#f4f1e7', marginTop: 9 },
  pendingSection: { marginTop: 12 }, pendingHeading: { color: '#706e5b', fontSize: 12, fontWeight: '700' }, pendingIntro: { color: '#898674', fontSize: 9.5, lineHeight: 14, marginTop: 3, marginBottom: 2 },
  pendingCopy: { flex: 1 }, pendingTitle: { color: '#6f6c58', fontSize: 10.5, fontWeight: '700' }, pendingText: { color: '#797660', fontSize: 9.5, lineHeight: 14, marginTop: 2 },
  ingredientsCard: { paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1' },
  ingredientRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  ingredientBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e7ede5' },
  position: { width: 25, color: '#819282', fontSize: 9, fontWeight: '700' }, ingredientCopy: { flex: 1 },
  ingredientName: { color: '#304a35', fontSize: 11.5, fontWeight: '600' }, ingredientMeta: { color: '#849187', fontSize: 9.5, marginTop: 3 },
  formulaFootnote: { color: '#8b968c', fontSize: 9, lineHeight: 14, paddingTop: 10, paddingBottom: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e7ede5' },
  noFormulaCard: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 23, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1' },
  noFormulaIcon: { width: 39, height: 39, borderRadius: 14, backgroundColor: '#edf4eb', alignItems: 'center', justifyContent: 'center' },
  noFormulaTitle: { color: '#304a35', fontSize: 13, fontWeight: '700', marginTop: 10 },
  body: { color: '#859087', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 6, maxWidth: 285 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 17, paddingTop: 9, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#e2e9e1', backgroundColor: '#f5f7f2' },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, borderRadius: 15, backgroundColor: '#e5eee3' },
  secondaryButtonText: { color: '#31543b', fontSize: 11, fontWeight: '700' },
  primaryButton: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: '#31543b' },
  primaryButtonText: { color: '#fff', fontSize: 11, fontWeight: '700' }, buttonDisabled: { opacity: 0.7 }, pressed: { opacity: 0.78 },
  actionError: { color: '#a64d3d', fontSize: 10, paddingHorizontal: 4, paddingTop: 8 },
  cacheBanner: { minHeight: 31, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, marginBottom: 10, borderRadius: 11, backgroundColor: '#edf3ec' },
  cacheText: { color: '#58745e', fontSize: 9.5 }, offlineBanner: { backgroundColor: '#f3eee3' }, offlineText: { color: '#806c50' },
  legacyBanner: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, marginBottom: 10, borderRadius: 11, backgroundColor: '#f3eee3' },
  legacyText: { flex: 1, color: '#806c50', fontSize: 9, lineHeight: 13 },
  legacyMeta: { color: '#8a785d', fontSize: 9.5, marginTop: 6 },
  rawText: { color: '#67796a', fontSize: 10, lineHeight: 15, marginTop: 12, textAlign: 'left', alignSelf: 'stretch' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  heroSkeleton: { width: 170, height: 170, borderRadius: 27, backgroundColor: '#e7eee5', marginBottom: 18 },
  skeletonLine: { width: '70%', height: 11, borderRadius: 5, backgroundColor: '#e4ebe2', marginTop: 8 }, skeletonLineShort: { width: '48%', height: 8, borderRadius: 4, backgroundColor: '#edf1eb', marginTop: 8 },
  errorIcon: { width: 49, height: 49, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#eaf2e8' },
  heading: { color: '#34463a', fontSize: 15, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 15, borderRadius: 14, backgroundColor: '#31543b' }, retryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
