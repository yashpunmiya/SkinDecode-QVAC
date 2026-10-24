export type UvWeather = {
  uvIndex: number;
  temperatureC: number;
  feelsLikeC: number;
  humidity: number;
  windSpeedKmh: number;
  weatherCode: number;
  observedAt: string;
};

type OpenMeteoResponse = {
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    relative_humidity_2m?: unknown;
    wind_speed_10m?: unknown;
    weather_code?: unknown;
    uv_index?: unknown;
  };
  error?: boolean;
  reason?: string;
};

const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 15 * 60 * 1000;
const weatherCache = new Map<string, { value: UvWeather; cachedAt: number }>();

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Weather data is missing ${label}.`);
  return value;
}

function locationKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

export async function fetchUvWeather(latitude: number, longitude: number): Promise<UvWeather> {
  // The provider resolves a nearby forecast grid cell, so two decimal places are enough
  // for this feature and avoid sending more location precision than needed.
  const roundedLatitude = Math.round(latitude * 100) / 100;
  const roundedLongitude = Math.round(longitude * 100) / 100;
  const key = locationKey(roundedLatitude, roundedLongitude);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const query = new URLSearchParams({
    latitude: String(roundedLatitude),
    longitude: String(roundedLongitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,uv_index',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${WEATHER_ENDPOINT}?${query.toString()}`, { signal: controller.signal });
    const body = await response.json() as OpenMeteoResponse;
    if (!response.ok || body.error || !body.current) {
      throw new Error(body.reason || 'The local weather service is unavailable.');
    }

    const value: UvWeather = {
      uvIndex: requiredNumber(body.current.uv_index, 'UV index'),
      temperatureC: requiredNumber(body.current.temperature_2m, 'temperature'),
      feelsLikeC: requiredNumber(body.current.apparent_temperature, 'feels-like temperature'),
      humidity: requiredNumber(body.current.relative_humidity_2m, 'humidity'),
      windSpeedKmh: requiredNumber(body.current.wind_speed_10m, 'wind speed'),
      weatherCode: requiredNumber(body.current.weather_code, 'weather condition'),
      observedAt: typeof body.current.time === 'string' ? body.current.time : new Date().toISOString(),
    };
    weatherCache.set(key, { value, cachedAt: Date.now() });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

export function uvPresentation(uvIndex: number) {
  if (uvIndex >= 11) return { label: 'Extreme', spf: 'SPF 50+', color: '#743d86', tint: '#f3eafa', advice: 'Limit time outdoors around midday. Seek shade and use protective clothing with SPF 50+.' };
  if (uvIndex >= 8) return { label: 'Very high', spf: 'SPF 50', color: '#a63e46', tint: '#faeded', advice: 'Protect your skin carefully. Seek shade and use protective clothing with SPF 50.' };
  if (uvIndex >= 6) return { label: 'High', spf: 'SPF 50', color: '#b45b2a', tint: '#fbf0e7', advice: 'Use sun protection and reduce time in direct midday sun. SPF 50 is suggested.' };
  if (uvIndex >= 3) return { label: 'Moderate', spf: 'SPF 30', color: '#987515', tint: '#f8f3df', advice: 'Sun protection is recommended outdoors. SPF 30 is suggested.' };
  return { label: 'Low', spf: 'SPF 15–30', color: '#477653', tint: '#edf5eb', advice: 'UV is low right now. SPF 15–30 is an option for longer time outdoors.' };
}

export function weatherCondition(code: number) {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Current conditions';
}
