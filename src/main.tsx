import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/theme-base.css';
import './styles/loading.css';
import './styles/abbai-flow.css';
import './styles/family.css';
import './styles/grocery.css';
import './styles/music.css';
import './styles/meals.css';
import './styles/screensaver.css';
import './styles/widgets.css';
import './styles/omni-add.css';
import './styles/settings.css';
import './styles/weather.css';
import './styles/focus.css';
import './styles/chore-planner.css';
import './styles/timer.css';
import './styles/debug-console.css';
// Screen design layer last: it refines the per-view stylesheets app-wide.
import './styles/surface.css';
// Responsive/touch additions only - loaded after everything else.
import './styles/responsive.css';
// Full-screen portrait display: a wall/tablet layout, distinct from phone UI.
import './styles/portrait-display.css';
import { applyStoredTheme } from './hooks/useTheme';
import { installDebugFetchCapture } from './api/debug-log';

// Apply stored theme immediately (before first paint) to prevent flash
applyStoredTheme();
installDebugFetchCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
