<p align="center">
  <img src="src/assets/abbai-flow-icon.svg" alt="Abbai Flow" width="112" />
</p>

<h1 align="center">Abbai Flow</h1>

<h3 align="center">Your family's daily signal</h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/nyabb/abbai-flow/releases"><img src="https://img.shields.io/github/v/release/nyabb/abbai-flow" alt="Version" /></a>
  <a href="https://github.com/nyabb/abbai-flow/stargazers"><img src="https://img.shields.io/github/stars/nyabb/abbai-flow" alt="Stars" /></a>
</p>

<p align="center">
  Abbai Flow is a free, open-source family organisation and gamification
  platform — routines, missions, chores, rewards and everyday family life on a
  wall-mounted display. Run it as a container next to Home Assistant, or
  standalone, with no subscription fees and no cloud dependency.
</p>

---

## Features

- **Weekly Calendar** -- Beautiful week view with color-coded family members; supports HA calendar entities and a built-in local calendar
- **Grocery & Shopping Lists** -- AnyList, Home Assistant Shopping List, and local list support
- **Task / Todo Lists** -- Home Assistant todo entities and local task lists, summarized on the calendar
- **Chore Tracking** -- Assign chores, track streaks, and celebrate completions with a family leaderboard
- **Music Controls** -- Control Spotify through Encore and Soloist, plus Home Assistant media players
- **Photo Slideshow** -- Display family photos between interactions
- **Timer / Countdown** -- On-screen timer for cooking, homework, and more
- **Screen Saver** -- Automatic screen saver with clock overlay
- **Weather** -- Real-time weather from your Home Assistant weather entity
- **8+ Themes** -- Light, Midnight, Midnight Light, Nord, Dracula, Monokai, Rose, Forest, and dark mode (automatic or manual)
- **Family Management** -- Per-member colors, calendar filtering, and PIN-based profiles
- **Meal Plan Data** -- Existing AnyList sync and MCP meal plan records remain available
- **Standalone Mode** -- Works without Home Assistant using local calendars, lists, and tasks

## Installation

Abbai Flow is a single container. It serves the web app and talks to Home
Assistant on the browser's behalf, so the tablet never needs a token.

### Docker (recommended)

```bash
docker run -d \
  --name abbai-flow \
  --restart unless-stopped \
  -p 3000:3000 \
  -v abbai-flow-data:/data \
  ghcr.io/nyabb/abbai-flow:latest
```

Open `http://<host>:3000`. Images are published for `linux/amd64` and
`linux/arm64`, so the same tag runs on a server and on a Raspberry Pi.

On first launch, open **Settings → Integrations** to connect Home Assistant,
Encore, and Spotify, or configure a recipe/menu JSON feed for meal planning.
Abbai Flow starts in standalone mode until you configure the services you want.
Integration settings are stored in the `/data` volume.

### Docker Compose

```yaml
services:
  abbai-flow:
    image: ghcr.io/nyabb/abbai-flow:latest
    restart: unless-stopped
    ports: ['3000:3000']
    volumes: ['abbai-flow-data:/data']
    # Optional direct Bluetooth control: mount the host socket into this service.
    # - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket

volumes:
  abbai-flow-data:
```

### Local development

```bash
npm ci
npm run dev          # http://localhost:5173
```

Enter the Home Assistant URL and access token in Abbai Flow's onboarding or
Settings → Integrations. The standalone app uses those saved credentials for
Home Assistant requests.

## Configuration

| Variable                            | Default     | Description |
| ----------------------------------- | ----------- | ----------- |
| `ABBAI_FLOW_PORT` or `PORT`         | `3000`      | HTTP port used by the server |
| `ABBAI_FLOW_DATA`                   | `/data`     | Directory for persisted family and integration data |
| `ABBAI_FLOW_DIST`                   | `/app/dist` | Built app directory |
| `ABBAI_FLOW_ALLOWED_ORIGINS`        | —           | Extra origins allowed to make state-changing requests |
| `ABBAI_FLOW_HA_CA`                  | —           | Optional CA certificate for a private Home Assistant TLS certificate |
| `ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS` | —           | Optional host D-Bus address; the socket must also be mounted into the container |

Home Assistant, Encore, and Spotify settings are read from the app's saved
integration settings in the persistent data directory. They are not read from
environment variables.

Spotify playlist management also needs the Spotify developer app's callback
URL registered under its Redirect URIs. Set it in **Settings → Integrations**
to `https://<your-app-host>/abbai-flow/music/oauth/callback`, then use the Music
page's Connect Spotify account button. The resulting refresh token is stored
server-side in the existing data directory with owner-only file permissions;
it is never sent to browser code.

Direct Bluetooth management is optional and does not use Snapcast or add a
container. To discover, pair, connect, disconnect or forget devices from Music,
mount the Raspberry Pi's `/run/dbus/system_bus_socket` into the Abbai Flow
container and set `ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS` to
`unix:path=/run/dbus/system_bus_socket`. The browser only talks to Abbai Flow's
same-origin API; it never receives D-Bus access or a host token. Pairing makes
the device available to the Pi. If Soloist does not select it automatically,
choose the Bluetooth output in Encore's Audio Outputs page.

Everything else — themes, family members, chores, routines, rewards, calendar
sources, list providers — is configured through the Abbai Flow UI.

### Integration logs

Use `docker logs abbai-flow` to see startup checks for Home Assistant
authentication and discovered calendars, todo lists, ChoreOps entities, Grocy
sensors, media players, weather, and media sources. Spotify logs report the
Encore connection, Spotify login/device state, and catalog credential status.
Bluetooth logs report whether host D-Bus access is configured, its connection
and retry state, and whether a Bluetooth adapter is powered on. Logs do not
include Spotify credentials, Bluetooth device addresses or pairing codes.
These checks report connection state and counts; they do not print access
tokens or client secrets. Google Photos is currently not implemented and is
reported as unavailable.

## Why Abbai Flow?

- **Free & open source** — no subscriptions, no cloud accounts, no vendor lock-in
- **Private by design** — all data stays on your network; nothing phones home
- **Home Assistant native** — deep integration with calendars, media players, lists, weather, and more
- **Works standalone** — built-in local calendar, task lists, and shopping lists work without HA
- **Fully themeable** — 8+ themes with automatic dark mode
- **Voice & LLM ready** — MCP server, voice API, and HA custom sentences for hands-free control

## Built With

- [React 19](https://react.dev/) -- UI framework
- [TypeScript](https://www.typescriptlang.org/) -- Type safety
- [Vite](https://vitejs.dev/) -- Build tool
- [Home Assistant](https://www.home-assistant.io/) -- Smart home platform
- [React 19](https://react.dev/) -- UI framework
- [Lucide](https://lucide.dev/) -- Icons
- [date-fns](https://date-fns.org/) -- Date utilities

## Documentation

- [Getting Started Guide](docs/getting-started.md) -- full walkthrough with screenshots
- [AI and Voice Control](docs/ai-integration.md) -- voice API, MCP server for LLM agents, HA Assist custom sentences
- [Contributing Guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## Support Abbai Flow

Abbai Flow is free and always will be. If it's useful to your family, consider supporting development:

<p>
  <a href="https://github.com/sponsors/asachs01"><img src="https://img.shields.io/badge/GitHub_Sponsors-♥_Sponsor-ea4aaa?style=for-the-badge&logo=github" alt="GitHub Sponsors" /></a>
  <a href="https://buymeacoffee.com/aaronsachs"><img src="https://img.shields.io/badge/Buy_Me_A_Coffee-☕_Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" /></a>
</p>

## License

Abbai Flow is [MIT licensed](LICENSE). Copyright 2026 Aaron Sachs.
