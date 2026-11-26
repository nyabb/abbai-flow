import { useState } from 'react';
import { usePhotos } from '../hooks/usePhotos';
import { useTranslation } from '../i18n';
import { LoadingPlaceholder } from './LoadingPlaceholder';

export interface ScreenSaverPhotosProps {
  intervalSeconds: number;
  transition: 'fade' | 'slide';
}

export function ScreenSaverPhotos({
  intervalSeconds,
  transition,
}: ScreenSaverPhotosProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const { currentPhoto, loading } = usePhotos(['uploaded'], intervalSeconds);
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="screensaver-photo-empty">
        <LoadingPlaceholder
          label={t('photoFrame.loading')}
          lines={3}
          className="loading-placeholder--screen screensaver-photo-loading"
        />
      </div>
    );
  }

  if (!currentPhoto) {
    return (
      <div className="screensaver-photo-empty">
        <p>{t('photoFrame.noPhotos')}</p>
        <p>{t('photoFrame.addPhotosHint')}</p>
      </div>
    );
  }

  const imageLoaded = loadedUrl === currentPhoto.url;

  return (
    <>
      {!imageLoaded && (
        <div className="screensaver-photo-empty">
          <LoadingPlaceholder
            label={t('photoFrame.loading')}
            lines={3}
            className="loading-placeholder--screen screensaver-photo-loading"
          />
        </div>
      )}
      <img
        key={currentPhoto.url}
        className={`screensaver-photo${imageLoaded ? ` screensaver-photo--${transition}` : ''}`}
        src={currentPhoto.url}
        alt={currentPhoto.caption || t('photoFrame.photoAlt')}
        onLoad={() => setLoadedUrl(currentPhoto.url)}
        onError={() => setLoadedUrl(currentPhoto.url)}
        style={{ opacity: imageLoaded ? 1 : 0 }}
      />
    </>
  );
}
