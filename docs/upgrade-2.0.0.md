# Upgrading to Abbai Flow 2.0.0

2.0.0 is the rename release. The application is now **Abbai Flow**, it ships as a
standalone container, and the Home Assistant add-on packaging is gone.

## What changed for you

| Area             | 1.x                                                      | 2.0.0                                    |
| ---------------- | -------------------------------------------------------- | ---------------------------------------- |
| Product name     | previous name                                            | Abbai Flow                               |
| Distribution     | Home Assistant add-on **or** container                   | container (`ghcr.io/<owner>/abbai-flow`) |
| Add-on manifests | `config.yaml`, `repository.yaml`, `build.yaml`, `run.sh` | removed                                  |
| Mirror tree      | `beacon/` kept in sync with `src/`                       | removed — one source tree                |
| Native wrappers  | (already unused)                                         | Makefile targets removed                 |

## Your data is preserved

Nothing was renamed in the storage layer, so an existing installation keeps its
chores, routines, missions, rewards, calendars, lists and settings:

- documents still live under the same keys (`beacon-planner-meta`,
  `beacon-reward-redemptions`, `beacon-local-tasks`, `beacon-settings`, …);
- the server API is still `/beacon-data/:key`.

Those identifiers carry the old name on purpose: renaming them would orphan
existing household data, so they stay until a versioned migration exists
(see `docs/rebrand-audit.md`).

### Environment variables were renamed

Configuration is no longer read under `BEACON_*` names. Update your container
definition if you set any of these:

| Old | New |
| --- | --- |
| `BEACON_DATA` | `ABBAI_FLOW_DATA` |
| `BEACON_DIST` | `ABBAI_FLOW_DIST` |
| `BEACON_ALLOWED_ORIGINS` | `ABBAI_FLOW_ALLOWED_ORIGINS` |
| `BEACON_HA_CA` | `ABBAI_FLOW_HA_CA` |
| `BEACON_PORT` | `PORT` (or `ABBAI_FLOW_PORT`) |

`HA_URL` and `HA_TOKEN` are unchanged, and remain the only two you normally
need. The browser-side global the server injects is now
`window.__ABBAI_FLOW_CONFIG__` (served at `/runtime-config.js`).

## Moving from the add-on to the container

1. Note your current options — most of them are stored in the app, not in the
   add-on panel: calendar sources, list providers, family members, chores,
   routines and rewards all live in the app's own data.
2. Copy the add-on's data directory (usually `/addon_configs/…/data`, or the
   path shown in the add-on's Info tab) so the `/data` volume of the container
   can be seeded with it.
3. Start the container:

   ```bash
   docker run -d --name abbai-flow -p 3000:3000 \
     -e HA_URL=https://homeassistant.local:8123 \
     -e HA_TOKEN=your_long_lived_access_token \
     -v abbai-flow-data:/data \
     ghcr.io/nyabb/abbai-flow:2.0.0
   ```

4. Open `http://<host>:3000` and confirm your family, chores and rewards are
   there. If the data volume was seeded correctly nothing else is needed.
5. Uninstall the old add-on once you are satisfied — keep its data directory
   until then.

## Compatibility promises

- No points are re-awarded, no reward is marked as given, no routine progress is
  reset by the upgrade.
- The Home Assistant integration (ChoreOps, calendars, `todo` lists, media
  players, weather) is unchanged.
- Standalone mode (no Home Assistant) still works, with local calendars, lists
  and tasks.

## Rolling back

The 1.x add-on and 2.0.0 read the same data documents, so rolling back is safe:
reinstall the 1.x add-on version and point it at the same data directory.
