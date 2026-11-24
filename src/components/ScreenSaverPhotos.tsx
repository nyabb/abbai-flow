import { usePhotos } from '../hooks/usePhotos';
import { useTranslation } from '../i18n';

export interface ScreenSaverPhotosProps {
  intervalSeconds: number;
  photoDirectory: string;
  transition: 'fade' | 'slide';
}

export function ScreenSaverPhotos({
  intervalSeconds,
  photoDirectory,
  transition,
}: ScreenSaverPhotosProps) {
  const { currentPhoto, loading } = usePhotos(
    ['ha_media', 'local'],
    intervalSeconds,
    photoDirectory,
  );
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="screensaver-photo-empty">
        <p>{t('photoFrame.loading')}</p>
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

  return (
    <img
      key={currentPhoto.url}
      className={`screensaver-photo screensaver-photo--${transition}`}
      src={currentPhoto.url}
      alt={currentPhoto.caption || t('photoFrame.photoAlt')}
    />
  );
}
