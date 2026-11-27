# Getting Started

Abbai Flow is a self-hosted family organizer for calendars, chores, routines,
rewards, meals, and shared displays.

## Start with Docker

```bash
docker run -d \
  --name abbai-flow \
  --restart unless-stopped \
  -p 3000:3000 \
  -v abbai-flow-data:/data \
  ghcr.io/nyabb/abbai-flow:latest
```

Open `http://<server-address>:3000`. Keep the `/data` volume mounted so family
records, integration settings, and uploaded screen saver photos persist across
container updates.

## Connect services

Open **Settings → Integrations** to configure supported calendar sources,
iCloud Reminders, weather, music, or meal data. These connections are optional;
local calendars and task lists work without an external service.

For calendar sources, add a CalDAV account, an ICS feed URL, or a Google
calendar connection. For Apple Reminders, enter the Apple Account details and
complete any verification steps shown in Settings.

## Configure the display

In **Settings → Display**, enable the screen saver and choose clock, photos, or
both. Upload images in **Settings → Photos**. The app resizes uploads before
saving them in `/data`. The same Display page includes the Kid Display launcher
for a family member's focused view.

## Run locally

```bash
npm ci
npm run dev
```

The development server uses local browser storage. To run the server-backed
app locally, build it and run `npm start` with `ABBAI_FLOW_DATA` and
`ABBAI_FLOW_DIST` configured as needed.
