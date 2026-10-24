import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { getCachedProductIntelligence, listShelfItems, removeShelfItem } from '../../../src/products/catalog-service';
import { productIntelligenceSummary } from '../../../src/products/product-intelligence';
import type { ShelfItem } from '../../../src/products/types';

const shelfFilters = [
  { key: 'cleanser', label: 'Cleansers' },
  { key: 'moisturizer', label: 'Moisturizers' },
  { key: 'treatment', label: 'Treatments' },
  { key: 'spf', label: 'SPF' },
  { key: 'other', label: 'Other' },
] as const;

type ShelfFilter = 'all' | typeof shelfFilters[number]['key'];

function productShelfCategory(item: ShelfItem): ShelfFilter {
  const text = `${item.product?.category || ''} ${item.product?.subcategory || ''} ${item.product?.name || ''}`.toLowerCase();
  if (/cleanser|cleansing|face wash/.test(text)) return 'cleanser';
  if (/moistur|cream|lotion|emollient/.test(text)) return 'moisturizer';
  if (/sunscreen|sun screen|sun care|\bspf\b|sun protection/.test(text)) return 'spf';
  if (/serum|treatment|retino|exfoliat|essence|ampoule/.test(text)) return 'treatment';
  return 'other';
}

export default function MyShelfScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [intelligenceLabels, setIntelligenceLabels] = useState<Record<number, string>>({});
  const [activeFilter, setActiveFilter] = useState<ShelfFilter>('all');
  const loadRequest = useRef(0);

  const visibleFilters = useMemo(() => {
    const present = new Set(items.map(productShelfCategory));
    return shelfFilters.filter((filter) => present.has(filter.key));
  }, [items]);
  const visibleItems = useMemo(
    () => activeFilter === 'all' ? items : items.filter((item) => productShelfCategory(item) === activeFilter),
    [activeFilter, items],
  );

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current;
    setIntelligenceLabels({});
    setItems([]);
    if (!userId) { setLoading(false); return; }
    setLoading(true); setOffline(false); setError(null);
    try {
      const result = await listShelfItems(userId);
      if (requestId !== loadRequest.current) return;
      setItems(result.items); setOffline(result.offline);
      const intelligence = await getCachedProductIntelligence(userId, result.items.map((item) => item.productId)).catch(() => new Map());
      if (requestId !== loadRequest.current) return;
      setIntelligenceLabels(Object.fromEntries([...intelligence].flatMap(([id, score]) => {
        const label = productIntelligenceSummary(score);
        return label ? [[id, label]] : [];
      })));
    } catch (loadError) {
      if (requestId !== loadRequest.current) return;
      setOffline(false);
      setError(loadError instanceof Error ? loadError.message : 'Your shelf could not be loaded. Please try again.');
    } finally { if (requestId === loadRequest.current) setLoading(false); }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const remove = (item: ShelfItem) => Alert.alert('Remove from My Shelf?', item.product?.name || 'This product', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void (async () => {
      if (!userId) return;
      setRemovingId(item.id); setError(null);
      try { await removeShelfItem(userId, item.id); setItems((current) => current.filter((row) => row.id !== item.id)); }
      catch { setError('This product could not be removed. Check your connection and retry.'); }
      finally { setRemovingId(null); }
    })() },
  ]);

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR COLLECTION</Text>
            <View style={styles.titleRow}><Text style={styles.title}>My Shelf</Text>{!loading && items.length > 0 ? <View style={styles.countPill}><Text style={styles.countText}>{items.length}</Text></View> : null}</View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Add a product to My Shelf" onPress={() => router.push('/products/search' as Href)} style={({ pressed }) => [styles.addProductButton, pressed && styles.pressed]}><Feather name="plus" size={17} color="#fff" /><Text style={styles.addProductLabel}>Add</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>Your skincare, beautifully organized.</Text>
          {!loading && items.length > 0 ? (
            <>
              <View style={styles.sectionHeadingRow}><Text style={styles.sectionHeading}>Your products</Text><Text style={styles.sectionCount}>{items.length} {items.length === 1 ? 'item' : 'items'}</Text></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterList}>
                <FilterChip label="All" selected={activeFilter === 'all'} onPress={() => setActiveFilter('all')} />
                {visibleFilters.map((filter) => <FilterChip key={filter.key} label={filter.label} selected={activeFilter === filter.key} onPress={() => setActiveFilter(filter.key)} />)}
              </ScrollView>
            </>
          ) : null}
          {offline ? <View style={styles.offlineBanner}><Feather name="wifi-off" size={14} color="#806c50" /><Text style={styles.offlineText}>Offline · showing your last saved shelf</Text></View> : null}
          {error ? <View style={styles.errorCard}><Feather name="alert-circle" size={16} color="#9a594d" /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
          {loading ? <View style={styles.center}><ActivityIndicator color="#31543b" /><Text style={styles.emptyBody}>Loading your shelf…</Text></View> : null}
          {!loading && !error && !offline && items.length === 0 ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><Feather name="shopping-bag" size={20} color="#66806b" /></View><Text style={styles.emptyTitle}>Make room for your routine</Text><Text style={styles.emptyBody}>Save the cleansers, treatments and moisturizers you use to keep their formulas close at hand.</Text><Pressable onPress={() => router.push('/products/search' as Href)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Text style={styles.addText}>Explore products</Text><Feather name="arrow-right" size={14} color="#fff" /></Pressable></View> : null}
          {!loading && items.length > 0 && visibleItems.length === 0 ? <View style={styles.noFilterResults}><Text style={styles.emptyBody}>No products in this category yet.</Text></View> : null}
          {!loading && visibleItems.length > 0 ? <View style={styles.productGrid}>{visibleItems.map((item) => item.product ? (
            <View key={item.id} style={styles.productCard}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.product.name}`} onPress={() => router.push(`/products/${item.productId}` as Href)} style={({ pressed }) => [styles.productMain, pressed && styles.productPressed]}>
                <View style={styles.imageStage}>
                  {item.product.imageUrl ? <Image source={{ uri: item.product.imageUrl }} style={styles.productImage} resizeMode="contain" /> : <View style={styles.imagePlaceholder}><Feather name="droplet" size={27} color="#89998c" /><Text style={styles.placeholderLabel}>SKINCARE</Text></View>}
                  <View style={styles.categoryBadge}><Text numberOfLines={1} style={styles.categoryBadgeText}>{item.product.subcategory || item.product.category || 'Skincare'}</Text></View>
                </View>
                <Text style={styles.productBrand} numberOfLines={1}>{item.product.brand}</Text>
                <Text style={styles.productName} numberOfLines={2}>{item.product.name}</Text>
                  {intelligenceLabels[item.productId] ? <View style={styles.matchBadge}><Feather name="check-circle" size={11} color="#42644a" /><Text numberOfLines={1} style={styles.matchText}>{intelligenceLabels[item.productId]}</Text></View> : <Text style={styles.productMeta} numberOfLines={1}>{item.product.quantity || item.product.category || 'Product details'}</Text>}
              </Pressable>
              <View style={styles.cardFooter}>
                <Text style={styles.savedLabel}>SAVED</Text>
                <Pressable disabled={removingId === item.id} onPress={() => remove(item)} accessibilityRole="button" accessibilityLabel={`Remove ${item.product.name} from My Shelf`} style={({ pressed }) => [styles.removeIconButton, pressed && styles.pressed]}>
                  {removingId === item.id ? <ActivityIndicator size="small" color="#8a766d" /> : <Feather name="trash-2" size={13} color="#8a766d" />}
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={item.id} style={styles.unknownProduct}><View style={styles.unknownIcon}><Feather name="package" size={17} color="#788879" /></View><View style={styles.unknownCopy}><Text style={styles.unknownTitle}>Product #{item.productId}</Text><Text style={styles.unknownBody}>Details will appear when the catalog is available.</Text></View></View>
          ))}</View> : null}
          {!loading && offline && items.length === 0 ? <View style={styles.offlineCard}><Feather name="wifi-off" size={18} color="#806c50" /><Text style={styles.emptyTitle}>Your shelf is not saved on this device yet</Text><Text style={styles.emptyBody}>Reconnect to load your account’s products.</Text></View> : null}
        </ScrollView>
      </SafeAreaView>
    </TabScreenTransition>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.filterChip, selected && styles.filterChipSelected, pressed && styles.pressed]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 21, paddingTop: 9, paddingBottom: 5 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#819084', fontSize: 8.5, fontWeight: '700', letterSpacing: 1.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { color: '#203329', fontFamily: 'Georgia', fontSize: 28, fontWeight: '700', marginTop: 3, letterSpacing: -0.5 },
  countPill: { minWidth: 25, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderRadius: 11, backgroundColor: '#e8efe6', marginTop: 4 },
  countText: { color: '#45624b', fontSize: 10, fontWeight: '700' },
  addProductButton: { height: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 13, borderRadius: 14, backgroundColor: '#31543b', shadowColor: '#31543b', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2 },
  addProductLabel: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 125 },
  subtitle: { color: '#849087', fontSize: 11, marginBottom: 13, paddingHorizontal: 2 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, paddingHorizontal: 2 },
  sectionHeading: { color: '#2c3b30', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  sectionCount: { color: '#8a958b', fontSize: 10, fontWeight: '600' },
  filterList: { gap: 7, paddingBottom: 13 },
  filterChip: { minHeight: 31, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eeefe9', borderWidth: 1, borderColor: '#eeefe9' },
  filterChipSelected: { backgroundColor: '#31543b', borderColor: '#31543b' },
  filterText: { color: '#758076', fontSize: 9.5, fontWeight: '600' },
  filterTextSelected: { color: '#fff' },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 11 },
  productCard: { width: '48.4%', padding: 7, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ebe4', shadowColor: '#23392a', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.045, shadowRadius: 9, elevation: 1 },
  productMain: {},
  pressed: { opacity: 0.82 },
  productPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  imageStage: { width: '100%', height: 123, position: 'relative', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 14, backgroundColor: '#f5f7f3' },
  productImage: { width: '88%', height: '88%' },
  imagePlaceholder: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 },
  placeholderLabel: { color: '#98a398', fontSize: 7, fontWeight: '700', letterSpacing: 1.2 },
  categoryBadge: { position: 'absolute', left: 6, bottom: 6, maxWidth: '88%', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: '#edf0e9' },
  categoryBadgeText: { color: '#607363', fontSize: 7.5, fontWeight: '700' },
  productBrand: { color: '#748277', fontSize: 8, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 9, paddingHorizontal: 2 },
  productName: { minHeight: 34, color: '#26372c', fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 3, paddingHorizontal: 2 },
  productMeta: { color: '#8a958c', fontSize: 8.5, lineHeight: 12, marginTop: 4, paddingHorizontal: 2 },
  matchBadge: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 6, borderRadius: 7, backgroundColor: '#edf4eb' },
  matchText: { flex: 1, color: '#42644a', fontSize: 8, fontWeight: '700' },
  cardFooter: { minHeight: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5, paddingHorizontal: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#edf0eb' },
  savedLabel: { color: '#99a198', fontSize: 7, fontWeight: '700', letterSpacing: 0.9 },
  removeIconButton: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#f5f3ef' },
  noFilterResults: { alignItems: 'center', paddingVertical: 28 },
  emptyCard: { minHeight: 290, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32, borderRadius: 23, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5', marginTop: 8 },
  emptyIcon: { width: 47, height: 47, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' },
  emptyTitle: { color: '#304236', fontSize: 14, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  emptyBody: { color: '#89938b', fontSize: 11, lineHeight: 16, textAlign: 'center', maxWidth: 255, marginTop: 6 },
  addButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 17, borderRadius: 14, backgroundColor: '#31543b', marginTop: 17 },
  addText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  center: { paddingVertical: 48, alignItems: 'center', gap: 9 },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: '#f3eee3', marginBottom: 12 },
  offlineText: { flex: 1, color: '#806c50', fontSize: 10 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 13, backgroundColor: '#f5eeea', marginBottom: 11 },
  errorText: { flex: 1, color: '#9a594d', fontSize: 10, lineHeight: 15 },
  retryText: { color: '#81534a', fontSize: 10, fontWeight: '700' },
  offlineCard: { alignItems: 'center', padding: 25, borderRadius: 20, backgroundColor: '#fff' },
  unknownProduct: { width: '100%', minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  unknownIcon: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#f1f3ee' },
  unknownCopy: { flex: 1 },
  unknownTitle: { color: '#33473a', fontSize: 12, fontWeight: '700' },
  unknownBody: { color: '#89938b', fontSize: 10, marginTop: 4 },
});
