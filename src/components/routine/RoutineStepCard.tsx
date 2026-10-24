import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoutineLogStatus, RoutineStep } from '../../routine/models';
import type { ProductSummary } from '../../products/types';
import { useReducedMotion } from '../useReducedMotion';
import { RoutineBottle } from './RoutineBottle';

type Props = {
  step: RoutineStep;
  order: number;
  isLast: boolean;
  status: RoutineLogStatus | null;
  onToggle: () => void;
  onSetStatus: (status: RoutineLogStatus | null) => void;
  product?: ProductSummary;
  onProductPress?: () => void;
  productMatchLabel?: string;
};

function frequencyLabel(frequency: number) {
  if (frequency >= 7) return 'Used every day';
  if (frequency === 1) return 'Once a week';
  return `${frequency}× a week`;
}

function categoryLabel(category: string | null | undefined, fallback: string) {
  const value = category?.trim();
  if (!value) return fallback;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function RoutineStepCard({
  step,
  order,
  isLast,
  status,
  onToggle,
  onSetStatus,
  product,
  onProductPress,
  productMatchLabel,
}: Props) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  const checkScale = useRef(new Animated.Value(status === 'completed' ? 1 : 0.82)).current;
  const checkOpacity = useRef(new Animated.Value(status === 'completed' ? 1 : 0)).current;
  const isComplete = status === 'completed';
  const isSkipped = status === 'skipped';
  const imageSource = useMemo(() => product?.imageUrl ? { uri: product.imageUrl } : null, [product?.imageUrl]);
  const hasProductImage = Boolean(imageSource && !imageFailed);
  const subtitle = step.notes?.trim() || frequencyLabel(step.frequencyPerWeek);

  useEffect(() => {
    setImageFailed(false);
  }, [product?.imageUrl]);

  useEffect(() => {
    if (reduceMotion) {
      checkScale.setValue(isComplete ? 1 : 0.82);
      checkOpacity.setValue(isComplete ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.spring(checkScale, { toValue: isComplete ? 1 : 0.82, speed: 20, bounciness: 4, useNativeDriver: true }),
      Animated.timing(checkOpacity, { toValue: isComplete ? 1 : 0, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [checkOpacity, checkScale, isComplete, reduceMotion]);

  return (
    <View style={[styles.rowWrap, isComplete && styles.rowWrapComplete, isSkipped && styles.rowWrapSkipped]}>
      <View style={styles.row}>
        <View style={styles.productImageWrap}>
          {hasProductImage ? (
            <Image
              accessible={false}
              source={imageSource!}
              resizeMode="contain"
              onError={() => setImageFailed(true)}
              style={styles.productImage}
            />
          ) : (
            <View style={styles.productPlaceholder}>
              <RoutineBottle size="routine" />
            </View>
          )}
        </View>

        <View style={styles.copy}>
          {product ? <Text style={styles.brand} numberOfLines={1}>{product.brand}</Text> : null}
          <Pressable
            disabled={!onProductPress}
            onPress={onProductPress}
            accessibilityRole={onProductPress ? 'button' : undefined}
            accessibilityLabel={onProductPress ? `View ${product?.name}` : undefined}
            style={styles.productPressable}
          >
            <Text style={[styles.title, isComplete && styles.titleComplete]} numberOfLines={2}>
              {product?.name || step.title}
            </Text>
          </Pressable>
          <View style={styles.metaRow}>
            <Text style={styles.metaText} numberOfLines={1}>
              {categoryLabel(product?.category, step.title)}
            </Text>
            <View style={styles.metaSeparator} />
            <Text style={styles.metaText} numberOfLines={1}>{subtitle}</Text>
          </View>
          {productMatchLabel ? <Text style={styles.matchText} numberOfLines={1}>For your skin · {productMatchLabel}</Text> : null}
          {isSkipped ? <Text style={styles.skippedLabel}>SKIPPED TODAY</Text> : null}
        </View>

        <View style={styles.actions}>
          <Text style={styles.orderText}>{order}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isComplete ? `Mark ${step.title} not done` : `Mark ${step.title} complete`}
            accessibilityState={{ checked: isComplete }}
            onPress={onToggle}
            style={({ pressed }) => [styles.checkButton, isComplete && styles.checkButtonComplete, pressed && styles.pressed]}
          >
            <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkOpacity }}>
              <Feather name="check" size={17} color="#fff" />
            </Animated.View>
            {!isComplete ? <View style={styles.checkOutline} /> : null}
            {isSkipped ? <Feather name="minus" size={17} color="#829084" style={styles.skippedMark} /> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More options for ${step.title}`}
            accessibilityState={{ expanded: actionsOpen }}
            onPress={() => setActionsOpen((open) => !open)}
            style={styles.moreButton}
          >
            <Feather name={actionsOpen ? 'x' : 'more-horizontal'} size={18} color="#869187" />
          </Pressable>
        </View>
      </View>

      {actionsOpen ? (
        <View style={styles.actionsRow}>
          {status ? (
            <Pressable onPress={() => { onSetStatus(null); setActionsOpen(false); }} style={styles.actionOption}>
              <Feather name="corner-up-left" size={14} color="#536a58" />
              <Text style={styles.actionText}>Undo</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => { onSetStatus('skipped'); setActionsOpen(false); }} style={styles.actionOption}>
              <Feather name="skip-forward" size={14} color="#536a58" />
              <Text style={styles.actionText}>Skip today</Text>
            </Pressable>
          )}
          {status === 'skipped' ? (
            <Pressable onPress={() => { onSetStatus('completed'); setActionsOpen(false); }} style={styles.actionOption}>
              <Feather name="check-circle" size={14} color="#536a58" />
              <Text style={styles.actionText}>Mark done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {!isLast ? <View style={styles.separator} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { backgroundColor: '#fff' },
  rowWrapComplete: { backgroundColor: '#fcfefb' },
  rowWrapSkipped: { backgroundColor: '#fafaf7' },
  row: { minHeight: 112, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 13 },
  productImageWrap: { width: 48, height: 78, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 9, backgroundColor: '#f7f8f5' },
  productImage: { width: 44, height: 74 },
  productPlaceholder: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#eef3ec' },
  copy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  brand: { color: '#879087', fontSize: 10, lineHeight: 14, fontWeight: '600', marginBottom: 2 },
  productPressable: { alignSelf: 'stretch' },
  title: { color: '#28352c', fontSize: 13, lineHeight: 17, fontWeight: '600' },
  titleComplete: { color: '#728077' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { flexShrink: 1, color: '#778278', fontSize: 10, lineHeight: 14 },
  metaSeparator: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#a7b0a8' },
  matchText: { color: '#658169', fontSize: 9.5, lineHeight: 13, fontWeight: '600', marginTop: 3 },
  skippedLabel: { color: '#8d785b', fontSize: 8.5, lineHeight: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: 4 },
  actions: { width: 36, alignItems: 'center', justifyContent: 'center', gap: 2 },
  orderText: { color: '#849087', fontSize: 10, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  checkButton: { position: 'relative', width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#f3f4f1' },
  checkButtonComplete: { backgroundColor: '#31543b' },
  checkOutline: { position: 'absolute', inset: 7, borderWidth: 1.2, borderColor: '#b9c3b8', borderRadius: 8 },
  skippedMark: { position: 'absolute' },
  moreButton: { width: 38, height: 32, alignItems: 'center', justifyContent: 'center' },
  actionsRow: { flexDirection: 'row', gap: 15, marginHorizontal: 75, marginTop: -4, paddingBottom: 11 },
  actionOption: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  actionText: { color: '#536a58', fontSize: 11.5, fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 75, backgroundColor: '#eceee9' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
});
