# Settings-Managed Integrations — Design

**Date:** 2026-11-24  
**Status:** Draft for implementation

## Purpose

Let a family configure Abbai Flow after the app starts, in Settings →
Integrations, instead of having to edit Docker Compose or rebuild the app to
provide service credentials.

## User-facing configuration

The Integrations page owns connection details and credentials for:

- Home Assistant URL and access token.
- Encore URL and token for Spotify playback.
- Spotify developer app ID, secret, market, and OAuth redirect URL.

The app already has UI settings for family name, theme, weather entity, photo
directory and interval, and screen-saver timeout. Those remain in their
existing General, Appearance, Integrations, and Display sections; they should
not need Docker variables to be changed after setup.

The current Integrations page shows Home Assistant status but does not let a
Docker user set its connection. Add editable fields, a **Test connection**
action, a save action, and explicit controls to clear stored secrets. Password
inputs stay blank when a secret is already saved; show only whether a value is
configured. Spotify and Encore settings use the same pattern. Never echo
secret values back to the browser.

## Runtime behavior

- A new container starts without integration credentials and remains usable in
  standalone mode. A parent can add credentials after opening the app.
- Validate Home Assistant URL and credentials before saving. Saving a new
  connection updates the running server proxy and takes effect after the UI
  refreshes.
- Store credentials on the server under the configured data directory with
  owner-only file permissions. The browser sends a secret only when the parent
  enters a replacement; reads return configured flags and safe non-secret
  fields only.
- Server-backed settings override environment defaults. Existing deployments
  can continue to use legacy environment values until a parent saves the new
  settings; persist the effective values on the first save so removing the old
  Compose variables does not lose them.
- Browser-only builds keep using the existing Home Assistant onboarding and
  local credential storage. Server-only integrations (Encore and Spotify
  catalog/playlist credentials) explain that they require the Abbai Flow
  backend when no server configuration endpoint is available.
- Secret fields are excluded from settings export/import, debug output, API
  responses, and browser storage in server-backed mode.

## Environment variable boundary

Remove service credentials and user preferences from new Docker Compose
examples. Keep environment variables that configure the container itself or
require host setup outside the app, including the HTTP port, data/dist paths,
allowed origins, custom TLS CA, Home Assistant add-on transport overrides, and
the Bluetooth D-Bus socket address. The UI cannot create a host socket mount or
change container networking.

During migration, continue reading legacy variables as initial defaults when
no saved settings exist. A successful save writes the resulting settings to
the persistent server store and makes that store authoritative. Update the
configuration guide and startup messages to direct users to the Integrations
page rather than instructing them to add integration secrets to Compose.

## Out of scope

- User accounts or remote authentication for the settings API.
- Moving container ports, storage paths, TLS trust configuration, or host
  device mounts into the browser.
- Removing browser-only Home Assistant onboarding.
- Exposing stored server credentials to the client for backup or display.

## Acceptance criteria

1. A fresh server deployment opens without integration environment variables
   and lets a parent enter Home Assistant credentials in Integrations.
2. The server tests credentials before applying them and reports actionable
   failure details without logging the token.
3. A valid connection is persisted across container restarts and used by both
   REST and WebSocket proxy paths.
4. Saved secrets never appear in runtime config JavaScript, ordinary data API
   responses, settings exports, or browser storage.
5. Existing Docker values remain effective until replaced in Settings; after a
   save, persisted values win over environment defaults.
6. Spotify and Encore server credentials can be changed and cleared from
   Integrations without exposing them to the browser after save.
7. New Compose/configuration docs direct users to the app for service
   credentials and retain only deployment-level settings as environment
   variables.
