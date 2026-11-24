// Automation: 06 — Weather at a Glance (~40s)
// Playwright-style pseudocode for screen recording

const viewport = { width: 1920, height: 1080 };
const baseUrl = 'http://localhost:8099';

// Scene 1: Current Conditions (0s–10s)
navigate(baseUrl);
wait(2000);
click('[data-nav="weather"]');
wait(2000);
startRecording('06-current-conditions');
// show current conditions and the forecast heading
wait(5000);
stopRecording();

// Scene 2: Full Forecast (10s–25s)
startRecording('06-full-forecast');
// the Weather view already contains the full forecast
// show 5-7 day forecast
wait(5000);
// scroll through days if needed
smoothScroll({ direction: 'down', distance: 200, duration: 3000 });
wait(3000);
stopRecording();

// Scene 3: Calendar Integration (25s–40s)
startRecording('06-calendar-weather');
click('[data-nav="calendar"]'); // switch to calendar
wait(2000);
// highlight the weather icons in day headers
hover('.calendar-day-header:nth-child(1) .weather-icon');
wait(2000);
hover('.calendar-day-header:nth-child(3) .weather-icon'); // rainy day
wait(2000);
hover('.calendar-day-header:nth-child(5) .weather-icon');
wait(2000);
stopRecording();
