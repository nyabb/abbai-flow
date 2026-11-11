# Audit — Beacon → Abbai Flow rebrand

State audited on `main` (`bfab7a0`), working tree clean.

## Where the old identity lives

| Kind                     | Location                                                                                                                                                                                              | Count / examples      | Action                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------- |
| Package identity         | `package.json` `name: "beacon"`                                                                                                                                                                       | 1                     | rename to `abbai-flow`                            |
| Browser title / metadata | `index.html` (`<title>`, og:, apple-touch-icon)                                                                                                                                                       | title + 3 asset paths | retitle, point at new mark                        |
| PWA                      | `public/manifest.json` (`name`, `short_name`, icons)                                                                                                                                                  | 9 icon paths          | retitle                                           |
| HA add-on                | `config.yaml` (`name`, `description`, `url`, `image`, `slug`, `photo_directory`), `repository.yaml`, `build.yaml`, `run.sh`                                                                           | 12                    | retitle; keep `slug`                              |
| Container                | `Dockerfile` labels, image name in workflow                                                                                                                                                           | few                   | retitle labels                                    |
| UI copy                  | `src/i18n/translations/*.ts` (`app.name`, brand strings), `src/App.tsx`, `src/components/Sidebar.tsx` (icon import + alt text)                                                                        | ~20                   | "Beacon" → "Abbai Flow"                           |
| Brand assets             | `src/assets/beacon-app-icon.svg` + PNG icon set, `branding/icon/*` (SVG wordmarks, manifest, README)                                                                                                  | 10 files              | new text-based mark; legacy PNGs kept (see below) |
| Docs (repo)              | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/*.md`, `docs-site/**` (Astro site, 60+ pages), `claude-plugin/**`                                                   | ~300 files            | prose rename                                      |
| CI                       | `.github/workflows/*` (`build-addon.yml`, `release.yml`, `deploy-docs.yml`)                                                                                                                           | 3                     | retitle; drop Netlify/Pages-to-Netlify material   |
| Netlify                  | `docs-site/astro.config.mjs`, `docs-site/public/robots.txt`, `.github/workflows/deploy-docs.yml`, `README.md`, `docs/getting-started.md`, `.gitignore`, `claude-plugin/README.md`, `beacon/README.md` | 8 files               | remove                                            |
| Releaser                 | `.releaserc.json` (tag format / repo URL)                                                                                                                                                             | 1                     | retitle                                           |

No `netlify.toml`, no `netlify/` directory, no Netlify npm dependency. Netlify survives only as _documentation_ and one deploy workflow.

## Lowercase `beacon` occurrences that must NOT be renamed

These are identifiers, not branding. Renaming them would break existing installations, orphaning family data:

1. **`/beacon-data/:key`** — the add-on's document API and the `beacon-store` client for it.
2. **Persisted document keys** — `beacon-planner-meta`, `beacon-reward-redemptions`, `beacon-timers`, `beacon-planner-ops`, `beacon-family`, `beacon-local-tasks`, `beacon_settings`, `beacon_paused_routines`, `beacon-todo`, `beacon-shopping`, `beacon_reward_reservations`, … A rename here without a migration loses chores, routines, reward progress and settings.
3. ~~**Home Assistant env contract**~~ — resolved. Configuration is read from
   `ABBAI_FLOW_ALLOWED_ORIGINS`, `ABBAI_FLOW_DATA`, `ABBAI_FLOW_DIST`,
   `ABBAI_FLOW_HA_CA` and `ABBAI_FLOW_PORT`, and the browser global the server
   injects is `window.__ABBAI_FLOW_CONFIG__`. The `BEACON_*` spellings are gone
   from the code; `docs/upgrade-2.0.0.md` lists the rename for anyone upgrading.
4. ~~**Add-on slug `beacon`**~~ — moot in 2.0.0: add-on packaging (and
   `config.yaml`) was dropped, so no slug exists any more.
5. **Theme/storage CSS variables** — already renamed away from the old brand in an earlier pass (`--skin-*`); nothing left.
6. ~~**`beacon/` mirror directory**~~ — deleted; the root tree is the only tree.
7. ~~**Asset file names** `beacon-*.png`~~ — resolved. The raster icon set is now
   generated from `src/assets/abbai-flow-icon.svg` (+ maskable and OG companions)
   by `scripts/export-icons.ts`, which writes stable paths into `public/`
   (`/icon-192.png`, `/favicon.svg`, `/og.png`). The old navy lighthouse artwork,
   its `branding/icon/` sources and the unrunnable `scripts/build-icons.py` are
   deleted.

## What is preserved

- Home Assistant add-on operation and the `todo`/ChoreOps integration.
- Standalone/Docker operation.
- All family data, storage keys and API paths (see above).
- Layout, accessibility and layout behaviour — no redesign.
- The dual `src/` ↔ `beacon/src/` mirror and `scripts/check-beacon-sync.sh`.

## Brand direction used

Modern Afrocentric identity with subtle Ethiopian / Blue Nile inspiration: deep river teal (`#0f6f6a`-family), gold (`#e0a11b`), terracotta (`#c2593c`) on a warm neutral surface; a simple woven-cross mark. No cultural clichés, no flag imagery.
