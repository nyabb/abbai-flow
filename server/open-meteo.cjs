const { createHash } = require('crypto');

const OPEN_METEO_HOSTS = new Set(['api.open-meteo.com', 'customer-api.open-meteo.com']);
const CACHE_TTL_MS = 10 * 60 * 1000;

function prepareForecastUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter a valid Open-Meteo forecast URL.');
  }

  if (
    url.protocol !== 'https:' ||
    !OPEN_METEO_HOSTS.has(url.hostname.toLowerCase()) ||
    (url.port !== '' && url.port !== '443') ||
    url.pathname.replace(/\/$/, '') !== '/v1/forecast' ||
    url.username ||
    url.password
  ) {
    throw new Error('Use the HTTPS Open-Meteo forecast URL from api.open-meteo.com.');
  }
  url.pathname = '/v1/forecast';
  if (url.searchParams.has('apikey') || url.searchParams.has('api_key')) {
    throw new Error('Enter the API key in the separate API key field.');
  }

  const latitudeValue = url.searchParams.get('latitude');
  const longitudeValue = url.searchParams.get('longitude');
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (
    latitudeValue === null ||
    latitudeValue.trim() === '' ||
    longitudeValue === null ||
    longitudeValue.trim() === '' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('The Open-Meteo URL must include valid latitude and longitude values.');
  }

  const addVariables = (parameter, required) => {
    const variables = new Set(
      (url.searchParams.get(parameter) || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    required.forEach((item) => variables.add(item));
    url.searchParams.set(parameter, [...variables].join(','));
  };

  addVariables('current', [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'wind_speed_10m',
    'wind_direction_10m',
    'surface_pressure',
    'weather_code',
    'is_day',
  ]);
  addVariables('daily', [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
  ]);
  addVariables('hourly', [
    'temperature_2m',
    'relative_humidity_2m',
    'wind_speed_10m',
    'precipitation_probability',
    'weather_code',
    'is_day',
  ]);
  if (!url.searchParams.has('timezone')) url.searchParams.set('timezone', 'auto');
  const forecastDays = Number(url.searchParams.get('forecast_days'));
  const days = Number.isFinite(forecastDays) && forecastDays > 0 ? forecastDays : 7;
  url.searchParams.set(
    'forecast_days',
    String(Math.min(16, Math.max(7, days))),
  );
  return url;
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function wmoCondition(code, isDay) {
  const weatherCode = numeric(code);
  if (weatherCode === undefined) return 'exceptional';
  if (weatherCode === 0) return isDay === 0 ? 'clear-night' : 'sunny';
  if (weatherCode === 1 || weatherCode === 2) return 'partlycloudy';
  if (weatherCode === 3) return 'cloudy';
  if (weatherCode === 45 || weatherCode === 48) return 'fog';
  if ([51, 53, 55, 61, 63, 80, 81].includes(weatherCode)) return 'rainy';
  if ([56, 57, 66, 67].includes(weatherCode)) return 'snowy-rainy';
  if ([65, 82].includes(weatherCode)) return 'pouring';
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'snowy';
  if (weatherCode === 95) return 'lightning-rainy';
  if ([96, 99].includes(weatherCode)) return 'hail';
  return 'exceptional';
}

function normalizeWeather(payload) {
  const current = payload?.current;
  const daily = payload?.daily;
  const hourly = payload?.hourly;
  const temperature = numeric(current?.temperature_2m);
  const dates = values(daily?.time);
  const hours = values(hourly?.time);
  if (!current || temperature === undefined || dates.length === 0 || hours.length === 0) {
    throw new Error('The URL did not return current, daily, and hourly forecast data.');
  }

  const dailyCodes = values(daily.weather_code);
  const highs = values(daily.temperature_2m_max);
  const lows = values(daily.temperature_2m_min);
  const precipitation = values(daily.precipitation_probability_max);
  const hourlyCodes = values(hourly.weather_code);
  const hourlyDaylight = values(hourly.is_day);
  const hourlyTemps = values(hourly.temperature_2m);
  const hourlyHumidity = values(hourly.relative_humidity_2m);
  const hourlyWind = values(hourly.wind_speed_10m);
  const hourlyPrecipitation = values(hourly.precipitation_probability);

  return {
    current: {
      condition: wmoCondition(current.weather_code, numeric(current.is_day)),
      temperature,
      temperatureUnit: payload.current_units?.temperature_2m || '°C',
      humidity: numeric(current.relative_humidity_2m),
      windSpeed: numeric(current.wind_speed_10m),
      windSpeedUnit: payload.current_units?.wind_speed_10m || 'km/h',
      windBearing: numeric(current.wind_direction_10m),
      pressure: numeric(current.surface_pressure),
      pressureUnit: payload.current_units?.surface_pressure || 'hPa',
      feelsLike: numeric(current.apparent_temperature),
    },
    forecast: dates
      .map((date, index) => ({
        datetime: String(date),
        condition: wmoCondition(dailyCodes[index], 1),
        temperature: numeric(highs[index]) ?? 0,
        templow: numeric(lows[index]) ?? 0,
        precipitation_probability: numeric(precipitation[index]),
      }))
      .slice(0, 7),
    hourly: hours.map((time, index) => ({
      datetime: String(time),
      condition: wmoCondition(hourlyCodes[index], numeric(hourlyDaylight[index])),
      temperature: numeric(hourlyTemps[index]) ?? 0,
      humidity: numeric(hourlyHumidity[index]),
      wind_speed: numeric(hourlyWind[index]),
      wind_speed_unit: payload.hourly_units?.wind_speed_10m || 'km/h',
      precipitation_probability: numeric(hourlyPrecipitation[index]),
    })),
  };
}

async function fetchForecast(value, apiKey = '') {
  const url = prepareForecastUrl(value);
  if (apiKey) url.searchParams.set('apikey', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed (HTTP ${response.status}). Check the URL and API key.`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Open-Meteo returned an invalid response.');
    }
    return normalizeWeather(payload);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Open-Meteo request timed out.');
    if (error instanceof Error && error.message.startsWith('Open-Meteo')) throw error;
    throw new Error('Could not reach Open-Meteo. Check the URL and server internet access.');
  } finally {
    clearTimeout(timeout);
  }
}

function createOpenMeteoService() {
  let cached = null;
  let pending = null;

  return {
    async getForecast(url, apiKey = '') {
      const normalizedUrl = prepareForecastUrl(url).toString();
      const keyFingerprint = createHash('sha256').update(apiKey).digest('hex');
      const cacheKey = `${normalizedUrl}\n${keyFingerprint}`;
      if (cached?.key === cacheKey && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.data;
      }
      if (pending?.key === cacheKey) return pending.promise;

      const promise = fetchForecast(normalizedUrl, apiKey).then((data) => {
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
    async test(url, apiKey = '') {
      const data = await fetchForecast(url, apiKey);
      return { ok: true, forecastDays: data.forecast.length };
    },
  };
}

module.exports = { createOpenMeteoService, prepareForecastUrl, normalizeWeather };
