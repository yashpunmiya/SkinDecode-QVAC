import type { DailySkinCheck, SkinCheckMetric } from '../daily-skin-check/rules';
import type { WaterHistoryEntry } from '../water/water-tracker';

const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export type SkinTrendMetric = {
  metric: SkinCheckMetric;
  count: number;
  average: number;
  first: number;
  last: number;
  delta: number;
  firstDate: string;
  lastDate: string;
};

export function calculateSkinTrend(history: DailySkinCheck[], days: 7 | 30, now = new Date()): SkinTrendMetric[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  const from = localDateKey(start);
  const through = localDateKey(now);
  const entries = history.filter((item) => item.localDate >= from && item.localDate <= through).sort((a, b) => a.localDate.localeCompare(b.localDate));
  const metrics: SkinCheckMetric[] = ['acne', 'redness', 'dryness', 'oiliness', 'irritation'];
  return metrics.flatMap((metric) => {
    const values = entries.map((item) => ({ date: item.localDate, value: item.ratings[metric] })).filter((item) => Number.isFinite(item.value));
    if (values.length < 2) return [];
    const first = values[0]!;
    const last = values[values.length - 1]!;
    return [{ metric, count: values.length, average: values.reduce((sum, item) => sum + item.value, 0) / values.length, first: first.value, last: last.value, delta: last.value - first.value, firstDate: first.date, lastDate: last.date }];
  });
}

export function calculateWaterTrend(entries: WaterHistoryEntry[], days: 7 | 30, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  const from = localDateKey(start);
  const through = localDateKey(now);
  const rows = entries.filter((entry) => entry.localDate >= from && entry.localDate <= through);
  if (!rows.length) return null;
  return { daysWithRecords: rows.length, averageGlasses: rows.reduce((sum, item) => sum + item.glasses, 0) / rows.length, totalGlasses: rows.reduce((sum, item) => sum + item.glasses, 0) };
}
