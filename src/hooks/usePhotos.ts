import { useState, useEffect } from 'react';
import type { Photo, PhotoSource } from '../types/photos';
import { getPhotos } from '../api/photos';

interface UsePhotosReturn {
  currentPhoto: Photo | null;
  loading: boolean;
}

const DEFAULT_INTERVAL = 30; // seconds

export function usePhotos(
  sources: PhotoSource[] = ['uploaded'],
  intervalSeconds: number = DEFAULT_INTERVAL,
): UsePhotosReturn {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Load photos on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void getPhotos(sources)
      .then((result) => {
        if (!cancelled) {
          setPhotos(result);
          setCurrentIndex(0);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(error);
        setPhotos([]);
        setCurrentIndex(0);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sources.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload the next photo for smooth transitions
  useEffect(() => {
    if (photos.length < 2) return;
    const nextIdx = (currentIndex + 1) % photos.length;
    const img = new Image();
    img.src = photos[nextIdx].url;
  }, [currentIndex, photos]);

  // Auto-cycle timer
  useEffect(() => {
    if (photos.length < 2) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photos.length);
    }, intervalSeconds * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [photos.length, intervalSeconds]);

  const currentPhoto = photos.length > 0 ? photos[currentIndex] : null;

  return {
    currentPhoto,
    loading,
  };
}
