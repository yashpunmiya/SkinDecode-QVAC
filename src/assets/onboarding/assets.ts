import type { ImageSourcePropType } from 'react-native';

type ConcernImageKey =
  | 'acne'
  | 'dark_spots'
  | 'redness'
  | 'dryness'
  | 'oiliness'
  | 'texture'
  | 'pores'
  | 'fine_lines'
  | 'dullness';

export const concernImages: Record<ConcernImageKey, ImageSourcePropType> = {
  acne: require('./concerns/acne.png'),
  dark_spots: require('./concerns/dark_spots.png'),
  redness: require('./concerns/redness.png'),
  dryness: require('./concerns/dryness.png'),
  oiliness: require('./concerns/oiliness.png'),
  texture: require('./concerns/texture.png'),
  pores: require('./concerns/pores.png'),
  fine_lines: require('./concerns/fine_lines.png'),
  dullness: require('./concerns/dullness.png'),
};

export const typeImages: Record<'oily' | 'dry' | 'combination' | 'normal' | 'not_sure', ImageSourcePropType> = {
  oily: concernImages.oiliness,
  dry: concernImages.dryness,
  combination: require('./types/combination.png'),
  normal: require('./types/normal.png'),
  not_sure: require('./types/not_sure.png'),
};

export const goalImages: Record<
  'clear_acne' | 'even_tone' | 'hydrate' | 'repair_barrier' | 'reduce_redness' | 'smooth_texture' | 'anti_aging' | 'maintain',
  ImageSourcePropType
> = {
  clear_acne: require('./goals/clear_acne.png'),
  even_tone: require('./goals/even_tone.png'),
  hydrate: require('./goals/hydrate.png'),
  repair_barrier: require('./goals/repair_barrier.png'),
  reduce_redness: require('./goals/reduce_redness.png'),
  smooth_texture: require('./goals/smooth_texture.png'),
  anti_aging: require('./goals/anti_aging.png'),
  maintain: require('./goals/maintain.png'),
};

export const sensitivityImages: Record<'low' | 'moderate' | 'high', ImageSourcePropType> = {
  low: require('./sensitivity/low.png'),
  moderate: require('./sensitivity/moderate.png'),
  high: require('./sensitivity/high.png'),
};
