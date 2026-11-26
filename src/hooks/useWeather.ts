import { useState, useEffect, useCallback } from 'react';
import { WeatherData } from '../types';
import { getWeatherForecast } from '../api/open-meteo';

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

export function useWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    try {
      const data = await getWeatherForecast();
      setWeather({
        temperature: data.current.temperature,
        temperatureUnit: data.current.temperatureUnit,
        condition: data.current.condition,
        humidity: data.current.humidity,
        windSpeed: data.current.windSpeed,
        forecast: data.forecast.map((day) => ({
          date: day.datetime.slice(0, 10),
          condition: day.condition,
          tempHigh: day.temperature,
          tempLow: day.templow,
        })),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch weather');
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(() => {
      // A hidden page (kiosk screensaver, switched input, sleeping screen) does
      // not need a new forecast; the visibility listener below catches up.
      if (document.visibilityState === 'hidden') return;
      void fetchWeather();
    }, REFRESH_INTERVAL);

    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void fetchWeather();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchWeather]);

  return { weather, error, refresh: fetchWeather };
}
