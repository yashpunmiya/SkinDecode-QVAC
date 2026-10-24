import { StyleSheet, View } from 'react-native';

type Props = { size?: 'preview' | 'routine' };

/** A quiet product silhouette for routine steps that do not have a product photo yet. */
export function RoutineBottle({ size = 'routine' }: Props) {
  return (
    <View style={[styles.frame, size === 'preview' ? styles.previewFrame : styles.routineFrame]}>
      <View style={[styles.cap, size === 'preview' ? styles.previewCap : styles.routineCap]} />
      <View style={[styles.neck, size === 'preview' ? styles.previewNeck : styles.routineNeck]} />
      <View style={[styles.body, size === 'preview' ? styles.previewBody : styles.routineBody]}>
        <View style={[styles.label, size === 'preview' ? styles.previewLabel : styles.routineLabel]}>
          <View style={styles.labelLine} />
          <View style={[styles.labelLine, styles.shortLabelLine]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center' },
  previewFrame: { width: 19, height: 30 },
  routineFrame: { width: 30, height: 57 },
  cap: { backgroundColor: '#93a89a', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  previewCap: { width: 8, height: 4 },
  routineCap: { width: 12, height: 6 },
  neck: { backgroundColor: '#c4d3c6' },
  previewNeck: { width: 10, height: 3 },
  routineNeck: { width: 15, height: 5 },
  body: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#e4ece3', borderColor: '#ccd9cd', borderWidth: 1 },
  previewBody: { width: 17, height: 22, borderRadius: 4 },
  routineBody: { width: 27, height: 42, borderRadius: 6 },
  label: { justifyContent: 'center', gap: 2, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.82)' },
  previewLabel: { width: 10, height: 8, paddingHorizontal: 2 },
  routineLabel: { width: 17, height: 15, paddingHorizontal: 3, gap: 2.5 },
  labelLine: { height: 1, borderRadius: 1, backgroundColor: '#adbcad' },
  shortLabelLine: { width: '65%' },
});
