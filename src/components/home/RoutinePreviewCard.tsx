import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { getRoutineProductSummaries } from '../../products/catalog-service';
import { getCachedLegacyProductDetail, getCachedProductsByIds, getCachedShelfItems } from '../../products/product-cache';
import type { ProductSummary } from '../../products/types';
import type { RoutinePeriod, RoutineStep } from '../../routine/models';
import { RoutineBottle } from '../routine/RoutineBottle';

type Props = {
  userId?: string;
  amSteps: RoutineStep[];
  pmSteps: RoutineStep[];
  loading?: boolean;
  unavailable?: boolean;
  onPress: () => void;
};

export function RoutinePreviewCard({ userId, amSteps, pmSteps, loading = false, unavailable = false, onPress }: Props) {
  const steps = useMemo(() => [...amSteps, ...pmSteps], [amSteps, pmSteps]);
  const linkedSteps = useMemo(() => steps.filter((step) => step.productId !== null || step.shelfItemId !== null), [steps]);
  const linksKey = useMemo(() => linkedSteps
    .map((step) => `${step.id}:${step.productId ?? ''}:${step.shelfItemId ?? ''}`)
    .sort()
    .join('|'), [linkedSteps]);
  const [products, setProducts] = useState<Record<string, ProductSummary>>({});
  const [productLookupLoading, setProductLookupLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !linkedSteps.length) {
      setProducts({});
      setProductLookupLoading(false);
      return () => { cancelled = true; };
    }

    setProducts({});
    setProductLookupLoading(true);
    void (async () => {
      try {
        const shelfItems = await getCachedShelfItems(userId).catch(() => null);
        const productIdByShelf = new Map((shelfItems || []).map((item) => [item.id, item.productId]));
        const compactIds = [...new Set(linkedSteps
          .filter((step) => step.productId === null && step.shelfItemId)
          .map((step) => productIdByShelf.get(step.shelfItemId!))
          .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))];
        const [compactProducts, legacyProducts] = await Promise.all([
          getCachedProductsByIds(compactIds).catch(() => new Map<number, ProductSummary>()),
          Promise.all(linkedSteps.filter((step) => step.productId !== null).map(async (step) => {
            const product = await getCachedLegacyProductDetail(step.productId!).catch(() => null);
            return product ? [step.id, product] as const : null;
          })),
        ]);

        const localProducts: Record<string, ProductSummary> = {};
        for (const step of linkedSteps) {
          if (step.productId !== null) continue;
          const productId = step.shelfItemId ? productIdByShelf.get(step.shelfItemId) : undefined;
          const product = productId === undefined ? undefined : compactProducts.get(productId);
          if (product) localProducts[step.id] = product;
        }
        for (const product of legacyProducts) {
          if (product) localProducts[product[0]] = product[1];
        }
        if (!cancelled) setProducts(localProducts);

        // Resolve only cache misses, in one bounded batch for the linked routine steps.
        const missingSteps = linkedSteps.filter((step) => !localProducts[step.id]);
        if (missingSteps.length) {
          const resolved = await getRoutineProductSummaries(userId, missingSteps);
          if (!cancelled) setProducts({ ...localProducts, ...Object.fromEntries(resolved) });
        }
      } catch (error) {
        console.warn('[home] routine preview product lookup failed', error);
      } finally {
        if (!cancelled) setProductLookupLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [linksKey, userId]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open your skincare routine"
      onPress={onPress}
      style={({ pressed }) => [styles.section, pressed && styles.cardPressed]}
    >
      <View style={styles.sectionHeader}>
        <Text style={styles.title}>Your routine</Text>
        <View style={styles.viewAction}>
          <Text style={styles.viewLabel}>View</Text>
          <Feather name="chevron-right" size={14} color="#718075" />
        </View>
      </View>

      {unavailable ? (
        <View style={styles.messageRow}>
          <Feather name="alert-circle" size={13} color="#907d68" />
          <Text style={styles.message}>Routine unavailable · Tap to retry</Text>
        </View>
      ) : (
        <View style={styles.periods}>
          <PeriodPreview
            period="am"
            steps={amSteps}
            products={products}
            loading={loading || (productLookupLoading && linkedSteps.some((step) => amSteps.includes(step)))}
          />
          <View style={styles.timelineLine} />
          <PeriodPreview
            period="pm"
            steps={pmSteps}
            products={products}
            loading={loading || (productLookupLoading && linkedSteps.some((step) => pmSteps.includes(step)))}
          />
        </View>
      )}
    </Pressable>
  );
}

function PeriodPreview({
  period,
  steps,
  products,
  loading,
}: {
  period: RoutinePeriod;
  steps: RoutineStep[];
  products: Record<string, ProductSummary>;
  loading: boolean;
}) {
  const morning = period === 'am';
  const visibleSteps = steps.slice(0, 4);
  const remaining = Math.max(0, steps.length - visibleSteps.length);

  return (
    <View style={styles.period}>
      <View style={[styles.periodIcon, morning ? styles.morningIcon : styles.eveningIcon]}>
        <Feather name={morning ? 'sun' : 'moon'} size={13} color={morning ? '#947443' : '#68738c'} />
      </View>
      <View style={styles.periodCopy}>
        <View style={styles.periodHeading}>
          <Text style={styles.periodName}>{morning ? 'Morning' : 'Evening'}</Text>
          <Text style={styles.stepCount}>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</Text>
        </View>
        <View style={styles.productStack}>
        {loading && !steps.length ? <ActivityIndicator size="small" color="#758a7b" /> : null}
        {visibleSteps.map((step, index) => (
          <ProductThumb
            key={step.id}
            step={step}
            product={products[step.id]}
            index={index}
          />
        ))}
        {remaining > 0 ? <Text style={styles.moreText}>+{remaining}</Text> : null}
          {!steps.length && !loading ? <Text style={styles.restLabel}>Rest day</Text> : null}
        </View>
      </View>
    </View>
  );
}

function ProductThumb({ step, product, index }: { step: RoutineStep; product?: ProductSummary; index: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = product?.imageUrl;

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <View style={[styles.thumb, index > 0 && styles.overlapThumb]}>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.productImage}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
          accessibilityLabel={product?.name}
        />
      ) : (
        <RoutineBottle size="preview" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 4, paddingTop: 2, paddingBottom: 1 },
  cardPressed: { opacity: 0.72 },
  sectionHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: '#1f3026', fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  viewAction: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 7, paddingLeft: 8 },
  viewLabel: { color: '#587360', fontSize: 12, fontWeight: '600' },
  periods: { position: 'relative', flexDirection: 'column', paddingLeft: 1 },
  period: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 10 },
  periodIcon: { zIndex: 1, width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 3, borderColor: '#f7f8f4' },
  morningIcon: { backgroundColor: '#f6eddd' },
  eveningIcon: { backgroundColor: '#eceef6' },
  periodCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  periodHeading: { minWidth: 75, gap: 2 },
  periodName: { color: '#29372f', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  stepCount: { color: '#89938b', fontSize: 11, lineHeight: 15, fontWeight: '500' },
  timelineLine: { position: 'absolute', top: 26, bottom: 26, left: 14, width: 1, backgroundColor: '#e0e7df' },
  productStack: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingLeft: 3 },
  thumb: { zIndex: 1, width: 37, height: 43, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 22, backgroundColor: '#f5f7f3', borderColor: '#fff', borderWidth: 2 },
  overlapThumb: { marginLeft: -9 },
  productImage: { width: 33, height: 40 },
  moreText: { color: '#68776d', fontSize: 10.5, fontWeight: '600', marginLeft: 6 },
  restLabel: { color: '#8c9890', fontSize: 11, marginLeft: 3 },
  messageRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  message: { color: '#857866', fontSize: 11, fontWeight: '500' },
});
