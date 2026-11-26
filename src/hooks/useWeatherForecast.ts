import { useState, useEffect, useCallback } from 'react';
import { ForecastDay } from '../types';
import { getWeatherForecast } from '../api/open-meteo';

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetches a 7-day daily forecast from Abbai Flow's configured weather provider.
 */
export function useWeatherForecast(): ForecastDay[] {
  const [forecast, setForecast] = useState<ForecastDay[]>([]);

  const fetchForecast = useCallback(async () => {
    try {
      const data = await getWeatherForecast();
      setForecast(
        data.forecast.map((day) => ({
          date: day.datetime.slice(0, 10),
          condition: day.condition,
          tempHigh: day.temperature,
          tempLow: day.templow,
        })),
      );
    } catch {
      // Silently ignore — weather is supplementary
    }
  }, []);

  useEffect(() => {
    fetchForecast();
    const interval = setInterval(fetchForecast, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchForecast]);

  return forecast;
}
