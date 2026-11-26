import { getRuntimeConfig } from '../config';
import type { WeatherApiKeyMode, WeatherDataMapping } from './integration-settings';

export interface OpenMeteoCurrent {
  condition: string;
  temperature: number;
  temperatureUnit: string;
  humidity?: number;
  windSpeed?: number;
  windSpeedUnit: string;
  windBearing?: number;
  pressure?: number;
  pressureUnit: string;
  feelsLike?: number;
}

export interface OpenMeteoDailyForecast {
  datetime: string;
  condition: string;
  temperature: number;
  templow: number;
  precipitation_probability?: number;
}

export interface OpenMeteoHourlyForecast {
  datetime: string;
  condition: string;
  temperature: number;
  humidity?: number;
  wind_speed?: number;
  wind_speed_unit: string;
  precipitation_probability?: number;
}

export interface WeatherForecastData {
  current: OpenMeteoCurrent;
  forecast: OpenMeteoDailyForecast[];
  hourly: OpenMeteoHourlyForecast[];
  sourceName: string;
  sourceUrl: string;
  fallbackUsed: boolean;
}

export type OpenMeteoWeatherData = WeatherForecastData;

const OPEN_METEO_HOSTS = new Set(['api.open-meteo.com', 'customer-api.open-meteo.com']);

/**
 * Accept a full Open-Meteo forecast URL and add the fields Abbai Flow displays.
 * The user only needs to provide a location; the remaining query options are
 * kept from their URL and supplemented as needed.
 */
export function prepareOpenMeteoUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
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

  const addVariables = (parameter: string, required: string[]) => {
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
  url.searchParams.set('forecast_days', String(Math.min(16, Math.max(7, days))));
  return url.toString();
}

function appWeatherUrl(path: string): string {
  const base = getRuntimeConfig() ? window.location.pathname.replace(/\/$/, '') : '';
  return `${base}${path}`;
}

async function getResponseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Weather request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

export async function getWeatherForecast(): Promise<WeatherForecastData> {
  if (!getRuntimeConfig()) {
    throw new Error('Weather forecasts require a server-backed Abbai Flow deployment.');
  }
  const response = await fetch(appWeatherUrl('/abbai-flow/weather/forecast'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  return (await getResponseJson(response)) as WeatherForecastData;
}

export interface WeatherConfigurationTest {
  openMeteoUrl: string;
  weatherApiUrl: string;
  apiKey: string;
  weatherApiKeyMode: WeatherApiKeyMode;
  weatherApiKeyParameter: string;
  weatherDataMapping: WeatherDataMapping;
}

export async function testWeatherConfiguration(
  settings: WeatherConfigurationTest,
): Promise<{
  ok: true;
  forecastDays: number;
  sourceName: string;
  fallbackUsed: boolean;
  primaryError?: string;
}> {
  const openMeteoUrl = settings.openMeteoUrl.trim()
    ? prepareOpenMeteoUrl(settings.openMeteoUrl)
    : '';
  if (!getRuntimeConfig()) {
    throw new Error('Weather settings require a server-backed Abbai Flow deployment.');
  }
  const response = await fetch(appWeatherUrl('/abbai-flow/weather/test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...settings, openMeteoUrl, apiKey: settings.apiKey }),
    cache: 'no-store',
  });
  return (await getResponseJson(response)) as {
    ok: true;
    forecastDays: number;
    sourceName: string;
    fallbackUsed: boolean;
    primaryError?: string;
  };
}
