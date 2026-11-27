import { createContext, useContext } from 'react';

export interface MusicDockContextValue {
  open: boolean;
  playing: boolean;
  toggle: () => void;
}

export const MusicDockContext = createContext<MusicDockContextValue | null>(null);

export function useMusicDockContext() {
  return useContext(MusicDockContext);
}
