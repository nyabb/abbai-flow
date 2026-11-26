import { useState, useEffect, useCallback } from 'react';
import { format, parseISO, isSameDay } from 'date-fns';
import { RefreshCw, ChevronDown, Droplets, Wind } from 'lucide-react';
import { weatherIcon, conditionLabel } from '../types/weather-icons';
import { getWeatherForecast } from '../api/open-meteo';
import { useTranslation } from '../i18n';
import { CollapsibleRegion } from './CollapsibleRegion';
import { LoadingPlaceholder } from './LoadingPlaceholder';

interface ForecastItem {
  datetime: string;
  condition: string;
  temperature: number;
  templow: number;
  humidity?: number;
  wind_speed?: number;
  precipitation_probability?: number;
}

interface HourlyItem {
  datetime: string;
  condition: string;
  temperature: number;
  humidity?: number;
  wind_speed?: number;
  wind_speed_unit: string;
  precipitation_probability?: number;
}

interface CurrentWeather {
  state: string;
  temperature: number;
  temperatureUnit: string;
  windSpeedUnit: string;
  humidity?: number;
  windSpeed?: number;
  windBearing?: number;
  pressure?: number;
  pressureUnit: string;
  feelsLike?: number;
}

export function WeatherView() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [hourly, setHourly] = useState<HourlyItem[]>([]);
  const [sourceName, setSourceName] = useState('Open-Meteo');
  const [sourceUrl, setSourceUrl] = useState('https://open-meteo.com/');
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [displayedDay, setDisplayedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getWeatherForecast();
      setCurrent({
        state: data.current.condition,
        temperature: data.current.temperature,
        temperatureUnit: data.current.temperatureUnit,
        windSpeedUnit: data.current.windSpeedUnit,
        humidity: data.current.humidity,
        windSpeed: data.current.windSpeed,
        windBearing: data.current.windBearing,
        pressure: data.current.pressure,
        pressureUnit: data.current.pressureUnit,
        feelsLike: data.current.feelsLike,
      });
      setForecast(data.forecast);
      setHourly(data.hourly);
      setSourceName(data.sourceName);
      setSourceUrl(data.sourceUrl);
      setFallbackUsed(data.fallbackUsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('weatherView.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleDayClick = (datetime: string) => {
    if (selectedDay === datetime) {
      setSelectedDay(null);
      return;
    }
    setDisplayedDay(datetime);
    setSelectedDay(datetime);
  };

  const hoursForDisplayedDay = displayedDay
    ? hourly.filter((h) => isSameDay(parseISO(h.datetime), parseISO(displayedDay)))
    : [];

  if (loading && !current) {
    return (
      <div className="weather-view">
        <div className="weather-loading">
          <LoadingPlaceholder
            label={t('weatherView.loading')}
            lines={5}
            className="loading-placeholder--screen"
          />
        </div>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="weather-view">
        <div className="weather-error">
          <p>{error}</p>
          <button type="button" className="weather-retry-btn" onClick={fetchData}>
            {t('weatherView.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const unit = current.temperatureUnit.replace('°', '');

  return (
    <div className="weather-view">
      {/* Current conditions */}
      <section className="weather-current">
        <div className="weather-current-main">
          <span className="weather-current-icon">{weatherIcon(current.state)}</span>
          <div className="weather-current-temp-block">
            <span className="weather-current-temp">
              {Math.round(current.temperature)}°{unit}
            </span>
            <span className="weather-current-condition">{conditionLabel(current.state, t)}</span>
          </div>
        </div>

        <div className="weather-current-details">
          {current.feelsLike != null && (
            <div className="weather-detail">
              <span className="weather-detail-label">{t('weatherView.feelsLike')}</span>
              <span className="weather-detail-value">
                {Math.round(current.feelsLike)}°{unit}
              </span>
            </div>
          )}
          {current.humidity != null && (
            <div className="weather-detail">
              <span className="weather-detail-label">{t('weatherView.humidity')}</span>
              <span className="weather-detail-value">{current.humidity}%</span>
            </div>
          )}
          {current.windSpeed != null && (
            <div className="weather-detail">
              <span className="weather-detail-label">{t('weatherView.wind')}</span>
              <span className="weather-detail-value">
                {Math.round(current.windSpeed)} {current.windSpeedUnit}
              </span>
            </div>
          )}
          {current.pressure != null && (
            <div className="weather-detail">
              <span className="weather-detail-label">{t('weatherView.pressure')}</span>
              <span className="weather-detail-value">
                {Math.round(current.pressure)} {current.pressureUnit}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="weather-refresh-btn"
          onClick={fetchData}
          disabled={loading}
          aria-busy={loading}
          title={t('weatherView.refreshWeather')}
          aria-label={t('weatherView.refreshWeather')}
        >
          <RefreshCw size={18} strokeWidth={1.5} />
        </button>
      </section>

      {/* 7-day forecast */}
      {forecast.length > 0 && (
        <section className="weather-forecast">
          <h2 className="weather-forecast-title">{t('weatherView.sevenDayForecast')}</h2>
          <div className="weather-forecast-scroll">
            {forecast.map((day) => {
              const date = parseISO(day.datetime);
              const dayName = format(date, 'EEE');
              const dateLabel = format(date, 'MMM d');
              const isSelected = selectedDay === day.datetime;
              return (
                <button
                  key={day.datetime}
                  type="button"
                  className={`weather-forecast-card${isSelected ? ' weather-forecast-card--selected' : ''}`}
                  onClick={() => handleDayClick(day.datetime)}
                  aria-expanded={isSelected}
                  aria-controls="weather-hourly-panel"
                >
                  <span className="weather-forecast-day">{dayName}</span>
                  <span className="weather-forecast-date">{dateLabel}</span>
                  <span className="weather-forecast-icon">{weatherIcon(day.condition)}</span>
                  <div className="weather-forecast-temps">
                    <span className="weather-forecast-high">
                      {Math.round(day.temperature)}°{unit}
                    </span>
                    <span className="weather-forecast-low">
                      {Math.round(day.templow)}°{unit}
                    </span>
                  </div>
                  {day.precipitation_probability != null && (
                    <span className="weather-forecast-precip">
                      {day.precipitation_probability}%
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`weather-forecast-chevron${isSelected ? ' weather-forecast-chevron--open' : ''}`}
                  />
                </button>
              );
            })}
          </div>

          {/* Keep the last selection mounted until its collapse animation ends. */}
          <CollapsibleRegion
            open={selectedDay !== null}
            className="weather-hourly-region"
            id="weather-hourly-panel"
          >
            {displayedDay && (
              <div className="weather-hourly">
                <div className="weather-hourly-header">
                  <h3 className="weather-hourly-title">
                    {t('weatherView.hourlyForDay', {
                      day: format(parseISO(displayedDay), 'EEEE, MMM d'),
                    })}
                  </h3>
                  <button
                    type="button"
                    className="weather-hourly-close"
                    onClick={() => setSelectedDay(null)}
                    aria-label={t('weatherView.closeHourlyForecastAria')}
                  >
                    {t('weatherView.collapse')}
                  </button>
                </div>
                {hoursForDisplayedDay.length === 0 ? (
                  <div className="weather-hourly-empty">{t('weatherView.noHourlyData')}</div>
                ) : (
                  <div className="weather-hourly-scroll">
                    {hoursForDisplayedDay.map((hour) => {
                      const time = parseISO(hour.datetime);
                      return (
                        <div key={hour.datetime} className="weather-hourly-card">
                          <span className="weather-hourly-time">{format(time, 'h a')}</span>
                          <span className="weather-hourly-icon">{weatherIcon(hour.condition)}</span>
                          <span className="weather-hourly-temp">
                            {Math.round(hour.temperature)}°{unit}
                          </span>
                          {hour.precipitation_probability != null && (
                            <span className="weather-hourly-precip">
                              <Droplets size={12} /> {hour.precipitation_probability}%
                            </span>
                          )}
                          {hour.wind_speed != null && (
                            <span className="weather-hourly-wind">
                              <Wind size={12} /> {Math.round(hour.wind_speed)}{' '}
                              {hour.wind_speed_unit}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </CollapsibleRegion>
        </section>
      )}
      <div className="weather-attribution">
        <a
          href={sourceName === 'Open-Meteo' ? 'https://open-meteo.com/' : sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {sourceName === 'Open-Meteo'
            ? fallbackUsed
              ? t('weatherView.backupAttribution')
              : t('weatherView.attribution')
            : t('weatherView.customAttribution', { source: sourceName })}
        </a>
      </div>
    </div>
  );
}
