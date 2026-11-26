const { createHash } = require('crypto');
const { createOpenMeteoService, prepareForecastUrl, normalizeWeather } = require('./open-meteo.cjs');

const WEATHER_MAPPING_KEYS = [
  'currentPath',
  'currentTemperaturePath',
  'currentConditionPath',
  'currentTemperatureUnitPath',
  'currentHumidityPath',
  'currentWindSpeedPath',
  'currentWindSpeedUnitPath',
  'currentWindBearingPath',
  'currentPressurePath',
  'currentPressureUnitPath',
  'currentFeelsLikePath',
  'forecastPath',
  'forecastDatePath',
  'forecastConditionPath',
  'forecastHighPath',
  'forecastLowPath',
  'forecastPrecipitationProbabilityPath',
  'hourlyPath',
  'hourlyDateTimePath',
  'hourlyConditionPath',
  'hourlyTemperaturePath',
  'hourlyHumidityPath',
  'hourlyWindSpeedPath',
  'hourlyWindSpeedUnitPath',
  'hourlyPrecipitationProbabilityPath',
];

const DEFAULT_WEATHER_MAPPING = {
  currentPath: '$.current',
  currentTemperaturePath: '$.temperature',
  currentConditionPath: '$.condition',
  currentTemperatureUnitPath: '$.temperatureUnit',
  currentHumidityPath: '$.humidity',
  currentWindSpeedPath: '$.windSpeed',
  currentWindSpeedUnitPath: '$.windSpeedUnit',
  currentWindBearingPath: '$.windBearing',
  currentPressurePath: '$.pressure',
  currentPressureUnitPath: '$.pressureUnit',
  currentFeelsLikePath: '$.feelsLike',
  forecastPath: '$.forecast',
  forecastDatePath: '$.datetime',
  forecastConditionPath: '$.condition',
  forecastHighPath: '$.temperature',
  forecastLowPath: '$.templow',
  forecastPrecipitationProbabilityPath: '$.precipitation_probability',
  hourlyPath: '$.hourly',
  hourlyDateTimePath: '$.datetime',
  hourlyConditionPath: '$.condition',
  hourlyTemperaturePath: '$.temperature',
  hourlyHumidityPath: '$.humidity',
  hourlyWindSpeedPath: '$.wind_speed',
  hourlyWindSpeedUnitPath: '$.wind_speed_unit',
  hourlyPrecipitationProbabilityPath: '$.precipitation_probability',
};

const CACHE_TTL_MS = 10 * 60 * 1000;

function isValidPath(value) {
  let candidate = String(value || '').trim();
  if (!candidate || candidate === '$') return true;
  if (candidate.startsWith('$')) {
    candidate = candidate.slice(1);
    if (candidate && !candidate.startsWith('.') && !candidate.startsWith('[')) return false;
  }
  if (candidate.startsWith('.')) candidate = candidate.slice(1);
  return /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|\[\d+\]|\[\])(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]*|\[\d+\]|\[\])|\[\d+\]|\[\])*$/u.test(candidate);
}

function resolvePath(root, path) {
  let candidate = String(path || '').trim();
  if (!candidate || candidate === '$') return root;
  if (candidate.startsWith('$')) candidate = candidate.slice(1);
  if (candidate.startsWith('.')) candidate = candidate.slice(1);
  const tokens = candidate.match(/[^.[\]]+|\[(\d*)\]/g) || [];
  let current = [root];
  for (const token of tokens) {
    const arrayMatch = token.match(/^\[(\d*)\]$/);
    if (arrayMatch) {
      const index = arrayMatch[1] === '' ? null : Number(arrayMatch[1]);
      current = current.flatMap((value) => {
        if (!Array.isArray(value)) return [];
        return index === null ? value : index < value.length ? [value[index]] : [];
      });
    } else {
      current = current.map((value) => (value == null ? undefined : value[token])).filter((v) => v !== undefined);
    }
  }
  if (tokens.some((token) => token === '[]')) return current.flatMap((value) => Array.isArray(value) ? value : [value]);
  return current.length > 1 ? current : current[0];
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function cleanUnit(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanTemperatureUnit(value) {
  const unit = String(value || '').trim().toLowerCase().replace(/[°\s]/g, '');
  if (['f', 'fahrenheit'].includes(unit)) return '°F';
  if (['c', 'celsius'].includes(unit)) return '°C';
  return cleanUnit(value, '°C');
}

function normalizeCondition(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const code = Number(value);
    if (code >= 200 && code <= 232) return 'lightning-rainy';
    if (code >= 300 && code <= 321) return 'rainy';
    if (code === 511) return 'snowy-rainy';
    if ((code >= 500 && code <= 504) || (code >= 520 && code <= 531)) {
      return code === 502 || code === 503 || code === 504 || code >= 522 ? 'pouring' : 'rainy';
    }
    if (code >= 600 && code <= 622) return 'snowy';
    if (code === 701 || code === 711 || code === 721 || code === 731 || code === 741 || code === 751 || code === 761 || code === 762) return 'fog';
    if (code === 771) return 'windy';
    if (code === 800) return 'sunny';
    if (code === 801 || code === 802) return 'partlycloudy';
    if (code === 803 || code === 804) return 'cloudy';
    return normalizeWeather({
      current: { temperature_2m: 0, weather_code: code, is_day: 1 },
      daily: { time: ['today'], weather_code: [code], temperature_2m_max: [0], temperature_2m_min: [0] },
      hourly: { time: ['today'], weather_code: [code], temperature_2m: [0] },
    }).current.condition;
  }
  const condition = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!condition) return 'exceptional';
  if (['sunny', 'clear', 'clear sky', 'fair', 'day'].includes(condition)) return 'sunny';
  if (['clear night', 'night', 'night clear'].includes(condition)) return 'clear-night';
  if (condition.includes('partly') || condition.includes('mostly sunny')) return 'partlycloudy';
  if (condition.includes('overcast') || condition.includes('cloud')) return 'cloudy';
  if (condition.includes('fog') || condition.includes('mist')) return 'fog';
  if (condition.includes('hail')) return 'hail';
  if (condition.includes('thunder') || condition.includes('lightning')) return 'lightning-rainy';
  if (condition.includes('snow') && (condition.includes('rain') || condition.includes('sleet'))) return 'snowy-rainy';
  if (condition.includes('snow') || condition.includes('flurr')) return 'snowy';
  if (condition.includes('pour') || condition.includes('heavy rain')) return 'pouring';
  if (condition.includes('rain') || condition.includes('drizzle') || condition.includes('shower')) return 'rainy';
  if (condition.includes('wind')) return 'windy';
  return condition.replace(/\s+/g, '-');
}

function mapCustomWeather(payload, inputMapping) {
  const mapping = { ...DEFAULT_WEATHER_MAPPING, ...(inputMapping || {}) };
  const currentSource = resolvePath(payload, mapping.currentPath);
  const currentTemperature = finiteNumber(resolvePath(currentSource, mapping.currentTemperaturePath));
  const currentCondition = resolvePath(currentSource, mapping.currentConditionPath);
  const forecastRows = resolvePath(payload, mapping.forecastPath);
  const hourlyRows = resolvePath(payload, mapping.hourlyPath);
  if (
    currentTemperature === undefined || currentCondition == null ||
    !Array.isArray(forecastRows) || !forecastRows.length ||
    !Array.isArray(hourlyRows) || !hourlyRows.length
  ) {
    throw new Error('Custom weather mapping must resolve current conditions, a daily forecast, and an hourly forecast.');
  }

  const current = {
    condition: normalizeCondition(currentCondition),
    temperature: currentTemperature,
    temperatureUnit: cleanTemperatureUnit(resolvePath(currentSource, mapping.currentTemperatureUnitPath)),
    humidity: finiteNumber(resolvePath(currentSource, mapping.currentHumidityPath)),
    windSpeed: finiteNumber(resolvePath(currentSource, mapping.currentWindSpeedPath)),
    windSpeedUnit: cleanUnit(resolvePath(currentSource, mapping.currentWindSpeedUnitPath), 'km/h'),
    windBearing: finiteNumber(resolvePath(currentSource, mapping.currentWindBearingPath)),
    pressure: finiteNumber(resolvePath(currentSource, mapping.currentPressurePath)),
    pressureUnit: cleanUnit(resolvePath(currentSource, mapping.currentPressureUnitPath), 'hPa'),
    feelsLike: finiteNumber(resolvePath(currentSource, mapping.currentFeelsLikePath)),
  };

  const forecast = forecastRows.map((row) => ({
    datetime: String(resolvePath(row, mapping.forecastDatePath) ?? ''),
    condition: normalizeCondition(resolvePath(row, mapping.forecastConditionPath)),
    temperature: finiteNumber(resolvePath(row, mapping.forecastHighPath)),
    templow: finiteNumber(resolvePath(row, mapping.forecastLowPath)),
    precipitation_probability: finiteNumber(resolvePath(row, mapping.forecastPrecipitationProbabilityPath)),
  })).filter((row) => row.datetime && Number.isFinite(Date.parse(row.datetime)) && row.temperature !== undefined && row.templow !== undefined).slice(0, 16);

  const hourly = hourlyRows.map((row) => ({
    datetime: String(resolvePath(row, mapping.hourlyDateTimePath) ?? ''),
    condition: normalizeCondition(resolvePath(row, mapping.hourlyConditionPath)),
    temperature: finiteNumber(resolvePath(row, mapping.hourlyTemperaturePath)),
    humidity: finiteNumber(resolvePath(row, mapping.hourlyHumidityPath)),
    wind_speed: finiteNumber(resolvePath(row, mapping.hourlyWindSpeedPath)),
    wind_speed_unit: cleanUnit(resolvePath(row, mapping.hourlyWindSpeedUnitPath), current.windSpeedUnit),
    precipitation_probability: finiteNumber(resolvePath(row, mapping.hourlyPrecipitationProbabilityPath)),
  })).filter((row) => row.datetime && Number.isFinite(Date.parse(row.datetime)) && row.temperature !== undefined).slice(0, 168);

  if (!forecast.length || !hourly.length) {
    throw new Error('Custom weather mapping did not produce dated forecast rows with temperatures.');
  }
  return { current, forecast, hourly };
}

function normalizeCustomUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter a valid custom weather API URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Use a valid HTTP or HTTPS custom weather API URL without embedded credentials.');
  }
  if (url.hash) url.hash = '';
  return url;
}

async function fetchJson(url, apiKey, keyMode, keyParameter) {
  const requestUrl = new URL(url.toString());
  const headers = { Accept: 'application/json' };
  if (apiKey) {
    if (keyMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
    else requestUrl.searchParams.set(keyParameter || 'apikey', apiKey);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(requestUrl, { headers, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Custom weather API returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error('Custom weather API returned invalid JSON.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Custom weather API request timed out.');
    if (error instanceof Error && error.message.startsWith('Custom weather API')) throw error;
    throw new Error('Could not reach the custom weather API. Check its URL and server network access.');
  } finally {
    clearTimeout(timeout);
  }
}

function createWeatherService() {
  const openMeteo = createOpenMeteoService();
  let cached = null;
  let pending = null;

  async function getBackup(settings) {
    const data = await openMeteo.getForecast(settings.openMeteoUrl);
    return { ...data, sourceName: 'Open-Meteo', sourceUrl: prepareForecastUrl(settings.openMeteoUrl).toString(), fallbackUsed: Boolean(settings.weatherApiUrl) };
  }

  async function fetchWeather(settings) {
    const customUrl = String(settings.weatherApiUrl || '').trim();
    if (!customUrl) return getBackup(settings);
    try {
      const url = normalizeCustomUrl(customUrl);
      const payload = await fetchJson(url, settings.weatherApiKey || '', settings.weatherApiKeyMode, settings.weatherApiKeyParameter);
      const data = mapCustomWeather(payload, settings.weatherDataMapping);
      return {
        ...data,
        sourceName: url.hostname,
        sourceUrl: url.origin,
        fallbackUsed: false,
      };
    } catch (error) {
      try {
        const backup = await getBackup(settings);
        return { ...backup, fallbackUsed: true, primaryError: error instanceof Error ? error.message : 'Custom weather API failed.' };
      } catch (backupError) {
        const primaryMessage = error instanceof Error ? error.message : 'Custom weather API failed.';
        const backupMessage = backupError instanceof Error ? backupError.message : 'Open-Meteo backup failed.';
        throw new Error(`${primaryMessage} Open-Meteo backup also failed: ${backupMessage}`);
      }
    }
  }

  return {
    async getForecast(settings) {
      const normalizedBackup = prepareForecastUrl(settings.openMeteoUrl).toString();
      const keyFingerprint = createHash('sha256').update(settings.weatherApiKey || '').digest('hex');
      const cacheKey = JSON.stringify([
        normalizedBackup,
        String(settings.weatherApiUrl || ''),
        keyFingerprint,
        settings.weatherApiKeyMode || 'query',
        settings.weatherApiKeyParameter || 'apikey',
        settings.weatherDataMapping || DEFAULT_WEATHER_MAPPING,
      ]);
      if (cached?.key === cacheKey && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
      if (pending?.key === cacheKey) return pending.promise;
      const promise = fetchWeather(settings).then((data) => {
        cached = { key: cacheKey, data, fetchedAt: Date.now() };
        return data;
      });
      pending = { key: cacheKey, promise };
      try {
        return await promise;
      } finally {
        if (pending?.promise === promise) pending = null;
      }
    },
    async test(settings) {
      const data = await fetchWeather(settings);
      return {
        ok: true,
        forecastDays: data.forecast.length,
        sourceName: data.sourceName,
        fallbackUsed: data.fallbackUsed,
        ...(data.primaryError ? { primaryError: data.primaryError } : {}),
      };
    },
  };
}

module.exports = {
  WEATHER_MAPPING_KEYS,
  DEFAULT_WEATHER_MAPPING,
  createWeatherService,
  isValidPath,
  mapCustomWeather,
  normalizeCustomUrl,
};
