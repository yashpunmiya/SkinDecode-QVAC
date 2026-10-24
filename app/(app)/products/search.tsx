import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { ProductRow } from '../../../src/components/products/ProductRow';
import { addProductToShelf, getCachedProductIntelligence, getShelfProductIds, searchProducts } from '../../../src/products/catalog-service';
import { productIntelligenceSummary } from '../../../src/products/product-intelligence';
import { useProductSelection } from '../../../src/products/ProductSelectionProvider';
import type { ProductSummary } from '../../../src/products/types';

export default function ProductSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; stepId?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { deliverRoutineProductSelection } = useProductSelection();
  const selectingForRoutine = params.mode === 'routine' && Boolean(params.stepId);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionProductId, setActionProductId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shelfProductIds, setShelfProductIds] = useState<Set<number>>(new Set());
  const [intelligenceLabels, setIntelligenceLabels] = useState<Record<number, string>>({});
  const requestToken = useRef(0);
  const activeSearch = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const searchQuery = query.trim();

  useEffect(() => {
    let active = true;
    setShelfProductIds(new Set());
    if (!userId) return () => { active = false; };
    void getShelfProductIds(userId).then((ids) => { if (active) setShelfProductIds(ids); }).catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    let active = true;
    setIntelligenceLabels({});
    if (!userId || items.length === 0) return () => { active = false; };
    void getCachedProductIntelligence(userId, items.map((item) => item.productId)).then((results) => {
      if (!active) return;
      setIntelligenceLabels(Object.fromEntries([...results].flatMap(([id, result]) => {
        const label = productIntelligenceSummary(result);
        return label ? [[id, label]] : [];
      })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [items, userId]);

  const runSearch = useCallback(async (term: string, append = false) => {
    const token = ++requestToken.current;
    if (term.length < 2) {
      setItems([]); setOffline(false); setHasMore(false); setError(null); setLoading(false); setLoadingMore(false);
      return;
    }
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    append ? setLoadingMore(true) : setLoading(true);
    if (!append) setOffline(false);
    setError(null);
    const offset = append ? itemsRef.current.length : 0;
    try {
      const result = await searchProducts(term, offset, controller.signal);
      if (token !== requestToken.current) return;
      setItems((current) => append ? [...current, ...result.items.filter((item) => !current.some((old) => old.productId === item.productId))] : result.items);
      setOffline(result.offline);
      setHasMore(result.hasMore);
    } catch (searchError) {
      if (token !== requestToken.current) return;
      setItems([]); setOffline(false); setHasMore(false);
      const code = searchError && typeof searchError === 'object' && 'code' in searchError
        ? String((searchError as { code?: unknown }).code)
        : '';
      setError(code === '57014'
        ? 'Search took too long. Try fewer words or try again.'
        : searchError instanceof Error ? searchError.message : 'Products could not be loaded. Please try again.');
    } finally {
      if (activeSearch.current === controller) activeSearch.current = null;
      if (token === requestToken.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  useEffect(() => {
    const term = searchQuery;
    const timer = setTimeout(() => { void runSearch(term); }, 300);
    return () => { clearTimeout(timer); activeSearch.current?.abort(); requestToken.current += 1; };
  }, [runSearch, searchQuery]);

  const openProduct = (product: ProductSummary) => router.push(`/products/${product.productId}` as Href);

  const saveProduct = async (product: ProductSummary) => {
    if (!userId) { setActionError('Sign in again to save products to your shelf.'); return; }
    setActionError(null); setActionProductId(product.productId);
    try {
      const shelfItem = await addProductToShelf(userId, product.productId);
      setShelfProductIds((current) => new Set([...current, shelfItem.product_id]));
      if (selectingForRoutine && params.stepId) {
        deliverRoutineProductSelection({ stepId: params.stepId, productId: product.productId, shelfItemId: shelfItem.id, productName: product.name });
        router.back();
      }
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'This product could not be saved. Check your connection and retry.');
    } finally { setActionProductId(null); }
  };

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}><Feather name="arrow-left" size={19} color="#24432f" /></Pressable>
          <View style={styles.headerCopy}><Text style={styles.eyebrow}>{selectingForRoutine ? 'YOUR ROUTINE' : 'SKINDECODE CATALOG'}</Text><Text style={styles.title}>{selectingForRoutine ? 'Choose a product' : 'Find a product'}</Text></View>
        </View>
        <View style={styles.searchBox}>
          <Feather name="search" size={18} color="#66806b" />
          <TextInput value={query} onChangeText={setQuery} placeholder="Product, brand, category or ingredient" placeholderTextColor="#929e94" autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} accessibilityLabel="Search by product, brand, category, or ingredient" />
          {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search"><Feather name="x-circle" size={17} color="#98a29a" /></Pressable> : null}
        </View>
        {actionError ? <Text style={styles.errorText} accessibilityRole="alert">{actionError}</Text> : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results} showsVerticalScrollIndicator={false}>
          {offline ? <View style={styles.offlineBanner}><Feather name="wifi-off" size={14} color="#806c50" /><Text style={styles.offlineText}>Offline · showing saved matches where available</Text></View> : null}
          {loading ? <View style={styles.skeletonList}>{[0, 1, 2].map((row) => <View key={row} style={styles.skeletonCard}><View style={styles.skeletonImage} /><View style={styles.skeletonCopy}><View style={styles.skeletonBrand} /><View style={styles.skeletonName} /><View style={styles.skeletonMeta} /></View></View>)}</View> : null}
          {!loading && error ? <View style={styles.stateCard}><Feather name="alert-circle" size={22} color="#a55c4e" /><Text style={styles.stateTitle}>Search unavailable</Text><Text style={styles.stateBody}>{error}</Text><Pressable onPress={() => void runSearch(searchQuery)} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
          {!loading && !error && searchQuery.length > 0 && searchQuery.length < 2 ? <View style={styles.hintCard}><Feather name="search" size={18} color="#58735e" /><Text style={styles.hintText}>Type at least 2 characters to search the catalog.</Text></View> : null}
          {!loading && !error && searchQuery.length >= 2 && items.length === 0 ? <View style={styles.stateCard}><View style={styles.emptyIcon}><Feather name={offline ? 'wifi-off' : 'search'} size={19} color="#58735e" /></View><Text style={styles.stateTitle}>{offline ? 'Nothing saved for offline search' : 'No close matches yet'}</Text><Text style={styles.stateBody}>{offline ? 'Reconnect to search the full catalog.' : 'Try another spelling or search fewer words. You can use a brand, product name, or category in the same search.'}</Text></View> : null}
          {!loading && !error && items.length > 0 ? <Text style={styles.resultCount}>{hasMore ? `Showing ${items.length}+ results` : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}</Text> : null}
          {items.map((product) => {
            const onShelf = shelfProductIds.has(product.productId);
            return <ProductRow key={product.productId} product={product} onPress={() => openProduct(product)} onShelf={onShelf} personalizationLabel={intelligenceLabels[product.productId]} actionLabel={selectingForRoutine ? 'Use in routine' : onShelf ? undefined : 'Save to My Shelf'} onAction={() => void saveProduct(product)} actionBusy={actionProductId === product.productId} />;
          })}
          {!loading && !searchQuery ? <View style={styles.introCard}><View style={styles.introIcon}><Feather name="droplet" size={19} color="#fff" /></View><Text style={styles.stateTitle}>Find your next skin essential</Text><Text style={styles.stateBody}>Search product names, brands, and categories together. Open a result for its full formula and ingredient details.</Text></View> : null}
          {hasMore && !loading ? <Pressable disabled={loadingMore} onPress={() => void runSearch(searchQuery, true)} style={styles.moreButton}>{loadingMore ? <ActivityIndicator size="small" color="#31543b" /> : <><Text style={styles.moreText}>Load more</Text><Feather name="chevron-down" size={15} color="#426348" /></>}</Pressable> : null}
        </ScrollView>
      </SafeAreaView>
    </TabScreenTransition>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f7f2' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 5, paddingBottom: 16 },
  backButton: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1e9df' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#66806b', fontSize: 9, fontWeight: '700', letterSpacing: 1.35 },
  title: { color: '#1d3827', fontFamily: 'Georgia', fontWeight: '700', fontSize: 25, marginTop: 2 },
  searchBox: { height: 51, marginHorizontal: 20, marginBottom: 12, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe8de', shadowColor: '#284b33', shadowOpacity: 0.035, shadowRadius: 8, elevation: 1 },
  input: { flex: 1, color: '#26382d', fontSize: 13, paddingVertical: 0 },
  results: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 34 },
  resultCount: { marginTop: 3, marginBottom: 10, paddingHorizontal: 2, color: '#7e8d80', fontSize: 10, fontWeight: '600' },
  skeletonList: { gap: 9, marginTop: 4 },
  skeletonCard: { height: 91, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8eee7' },
  skeletonImage: { width: 68, height: 68, borderRadius: 15, backgroundColor: '#eaf0e8' },
  skeletonCopy: { flex: 1, gap: 7 },
  skeletonBrand: { width: '35%', height: 7, borderRadius: 4, backgroundColor: '#e7eee5' },
  skeletonName: { width: '78%', height: 11, borderRadius: 5, backgroundColor: '#e5ebe3' },
  skeletonMeta: { width: '55%', height: 7, borderRadius: 4, backgroundColor: '#edf1eb' },
  stateCard: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 23, paddingVertical: 32, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4ebe2', marginTop: 5 },
  stateTitle: { color: '#2c4432', fontSize: 15, lineHeight: 20, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  stateBody: { color: '#839087', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 6, maxWidth: 290 },
  retryButton: { marginTop: 15, borderRadius: 13, paddingHorizontal: 17, paddingVertical: 9, backgroundColor: '#31543b' },
  retryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  hintCard: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderRadius: 15, backgroundColor: '#edf4eb' },
  hintText: { flex: 1, color: '#617462', fontSize: 11, lineHeight: 16 },
  emptyIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf4eb' },
  introCard: { minHeight: 245, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 30, borderRadius: 24, backgroundColor: '#eaf2e8', borderWidth: 1, borderColor: '#dce8da', marginTop: 2 },
  introIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#31543b' },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: '#f3eee3', marginBottom: 11 },
  offlineText: { flex: 1, color: '#806c50', fontSize: 10.5 },
  errorText: { color: '#a64d3d', fontSize: 11, marginHorizontal: 20, marginBottom: 8 },
  moreButton: { minHeight: 45, marginTop: 4, borderRadius: 14, borderWidth: 1, borderColor: '#dce7da', backgroundColor: '#f8faf7', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  moreText: { color: '#426348', fontSize: 11, fontWeight: '700' },
});
