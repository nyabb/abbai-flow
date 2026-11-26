import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
  deleteScreenSaverPhotos,
  listScreenSaverPhotos,
  screenSaverPhotoUrl,
  uploadScreenSaverPhoto,
  type SavedScreenSaverPhoto,
} from '../../../api/screensaver-photos';
import type { AbbaiSettings } from '../../../hooks/useSettings';
import { imageFileToScreenSaverDataUrl } from '../../../utils/screensaver-photo';
import { Segment, Slider } from '../controls';
import type { SettingsSectionContext } from './context';

const MAX_PHOTOS = 50;

type PhotosSectionProps = SettingsSectionContext;

export function PhotosSection({ settings, onUpdateSettings, t }: PhotosSectionProps) {
  const [photos, setPhotos] = useState<SavedScreenSaverPhoto[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(listScreenSaverPhotos)
      .then((result) => {
        if (!cancelled) setPhotos(result);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('settings.photos.loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    if (photos.length + files.length > MAX_PHOTOS) {
      setError(t('settings.photos.limitError', { remaining: MAX_PHOTOS - photos.length }));
      return;
    }

    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const dataUrl = await imageFileToScreenSaverDataUrl(file);
        const saved = await uploadScreenSaverPhoto(file.name, dataUrl);
        setPhotos((current) => [...current, saved]);
      }
      setSelectedIds([]);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : t('settings.photos.uploadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      await deleteScreenSaverPhotos(ids);
      const removed = new Set(ids);
      setPhotos((current) => current.filter((photo) => !removed.has(photo.id)));
      setSelectedIds((current) => current.filter((id) => !removed.has(id)));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t('settings.photos.deleteError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const allSelected = photos.length > 0 && selectedIds.length === photos.length;

  return (
    <>
      <h2 className="settings-section-title">{t('settings.photos.title')}</h2>
      <p className="settings-section-desc">{t('settings.photos.description')}</p>

      <div className="settings-group">
        <div className="settings-row photos-library-summary">
          <div>
            <div className="settings-row-label">
              {t('settings.photos.count', { count: photos.length })}
            </div>
            <div className="settings-row-sublabel">{t('settings.photos.limitHint')}</div>
          </div>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || loading || photos.length >= MAX_PHOTOS}
          >
            <ImagePlus size={16} />
            {busy ? t('settings.photos.uploading') : t('settings.photos.upload')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleUpload}
            className="photos-library-file-input"
            tabIndex={-1}
          />
        </div>

        {error && <p className="photos-library-error" role="alert">{error}</p>}

        {photos.length > 0 && (
          <div className="photos-library-actions">
            <button
              type="button"
              className="settings-btn"
              onClick={() => setSelectedIds(allSelected ? [] : photos.map((photo) => photo.id))}
              disabled={busy}
            >
              {allSelected ? t('settings.photos.clearSelection') : t('settings.photos.selectAll')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--danger"
              onClick={() => void handleDelete(selectedIds)}
              disabled={busy || selectedIds.length === 0}
            >
              <Trash2 size={16} />
              {t('settings.photos.deleteSelected', { count: selectedIds.length })}
            </button>
          </div>
        )}

        {loading ? (
          <p className="settings-row-sublabel">{t('settings.photos.loading')}</p>
        ) : photos.length === 0 ? (
          <p className="photos-library-empty">{t('settings.photos.empty')}</p>
        ) : (
          <div className="photos-library-grid">
            {photos.map((photo) => {
              const selected = selectedIds.includes(photo.id);
              return (
                <article
                  key={photo.id}
                  className={`photos-library-card${selected ? ' photos-library-card--selected' : ''}`}
                >
                  <img src={screenSaverPhotoUrl(photo.id)} alt={photo.name} loading="lazy" />
                  <div className="photos-library-card-footer">
                    <label className="photos-library-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSelectedIds((current) =>
                            selected
                              ? current.filter((id) => id !== photo.id)
                              : [...current, photo.id],
                          )
                        }
                        disabled={busy}
                        aria-label={t('settings.photos.selectPhoto', { name: photo.name })}
                      />
                      <span title={photo.name}>{photo.name}</span>
                    </label>
                    <button
                      type="button"
                      className="photos-library-delete"
                      onClick={() => void handleDelete([photo.id])}
                      disabled={busy}
                      aria-label={t('settings.photos.deletePhoto', { name: photo.name })}
                      title={t('settings.photos.deletePhoto', { name: photo.name })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.slideshowIntervalLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.integrations.slideshowIntervalSublabel')}
            </div>
          </div>
          <Slider
            value={settings.photoInterval}
            min={10}
            max={120}
            step={5}
            unit="s"
            onChange={(value) => onUpdateSettings({ photoInterval: value })}
          />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">
              {t('settings.integrations.transitionStyleLabel')}
            </div>
          </div>
          <Segment
            value={settings.photoTransition}
            options={[
              { value: 'fade', label: t('settings.integrations.fade') },
              { value: 'slide', label: t('settings.integrations.slide') },
            ]}
            onChange={(value) =>
              onUpdateSettings({ photoTransition: value as AbbaiSettings['photoTransition'] })
            }
          />
        </div>
      </div>
    </>
  );
}
