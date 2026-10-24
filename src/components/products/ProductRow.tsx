import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProductSummary } from '../../products/types';

type Props = {
  product: ProductSummary;
  onPress: () => void;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  onShelf?: boolean;
  personalizationLabel?: string | null;
};

export function ProductRow({ product, onPress, actionLabel, onAction, actionBusy = false, onShelf = false, personalizationLabel }: Props) {
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="contain" /> : <View style={[styles.image, styles.imageFallback]}><Feather name="droplet" size={20} color="#819083" /></View>}
        <View style={styles.copy}>
          <Text style={styles.brand} numberOfLines={1}>{product.brand}</Text>
          <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{[product.category, product.subcategory].filter(Boolean).join(' · ') || 'Skincare product'}</Text>
          {product.matchedIngredients.length ? <Text style={styles.match} numberOfLines={1}>Ingredient match · {product.matchedIngredients.slice(0, 2).join(', ')}</Text> : null}
          {personalizationLabel ? <Text style={styles.match} numberOfLines={1}>For your skin · {personalizationLabel}</Text> : null}
          {product.flags.length ? <View style={styles.badges}>{product.flags.slice(0, 2).map((flag) => <Text key={`${flag.id}-${flag.label}`} style={styles.badge}>{flag.label}</Text>)}</View> : null}
        </View>
        {onShelf ? <View style={styles.savedMark}><Feather name="bookmark" size={12} color="#31543b" /></View> : <Feather name="chevron-right" size={18} color="#9aa49b" />}
      </Pressable>
      {actionLabel && onAction ? (
        <Pressable disabled={actionBusy} onPress={onAction} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed, actionBusy && styles.disabled]}>
          <Feather name={actionBusy ? 'loader' : onShelf ? 'check' : 'plus'} size={14} color="#35553f" />
          <Text style={styles.actionText}>{actionBusy ? 'Adding…' : actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, padding: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3eae2', shadowColor: '#294b35', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.035, shadowRadius: 8, elevation: 1 },
  main: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12 },
  image: { width: 68, height: 68, borderRadius: 15, backgroundColor: '#f1f5ef' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 },
  brand: { color: '#718176', fontSize: 9, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  name: { color: '#203a2b', fontSize: 13, lineHeight: 17, fontWeight: '700' },
  meta: { color: '#839087', fontSize: 10.5 },
  match: { color: '#4d7454', fontSize: 9.5, marginTop: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  badge: { overflow: 'hidden', color: '#41674a', fontSize: 8, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: '#edf5ed' },
  savedMark: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8f1e8' },
  action: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e6ece5', marginTop: 6 },
  actionText: { color: '#35553f', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.77 },
});
