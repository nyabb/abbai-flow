// Automation: 01 — Meet Abbai Flow (~45s)
// Playwright-style pseudocode for screen recording

// Setup
const viewport = { width: 1920, height: 1080 };
const baseUrl = 'http://localhost:8099';

// Scene 1: Calendar Overview (0s–15s)
navigate(baseUrl);
wait(2000); // let the calendar and today's summary load
startRecording('01-calendar-overview');
wait(15000); // hold on the full week and today's summary
stopRecording();

// Scene 2: Quick Feature Scan (15s–35s)
startRecording('01-feature-scan');
smoothScroll({ target: '[data-section="calendar"]', duration: 3000 });
wait(2000);
smoothScroll({ target: '[data-section="lists"]', duration: 3000 });
wait(2000);
smoothScroll({ target: '[data-section="weather"]', duration: 3000 });
wait(2000);
smoothScroll({ target: '[data-section="media"]', duration: 3000 });
wait(2000);
stopRecording();

// Scene 3: Closing (35s–45s)
startRecording('01-closing');
smoothScroll({ target: 'body', position: 'top', duration: 2000 });
wait(3000); // hold on the calendar
// overlay Abbai Flow logo in post-production
wait(5000);
stopRecording();
