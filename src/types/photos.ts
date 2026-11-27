export type PhotoSource = 'uploaded';

export interface Photo {
  url: string;
  caption?: string;
  date?: string;
  source: PhotoSource;
}

export type PhotoTransition = 'fade' | 'slide';

export interface PhotoConfig {
  sources: PhotoSource[];
  interval_seconds: number;
  transition: PhotoTransition;
  show_clock: boolean;
  show_weather: boolean;
}
