# Abbai Flow — Claude Code Plugin

Control your [Abbai Flow](https://github.com/nyabb/abbai-flow) family dashboard from Claude Code.

## What you get

**Skills** — Domain knowledge for chores, calendars, meal plans, dashboard layout, and the MCP server.

**Commands:**
- `/create-chore` — Create a family chore with assignments and payouts
- `/family-schedule` — Per-person calendar breakdown for today
- `/whats-for-dinner` — Today's meal plan
- `/chore-status` — Chore completion status and earnings

**17 MCP tools** for lists, calendar, media, weather, chores, family members, and meal plans.

## Setup

1. Install the plugin:
   ```
   /plugin marketplace add nyabb/abbai-flow
   ```

2. Set environment variables (or create `.env` from `.env.example`):
   ```bash
   export ABBAI_FLOW_HA_TOKEN="your-ha-long-lived-access-token"
   export ABBAI_FLOW_HA_URL="http://homeassistant.local:8123"
   export ABBAI_FLOW_DATA_DIR="/path/to/beacon/data"
   ```

3. Generate an HA token: **Profile > Security > Long-Lived Access Tokens > Create Token**

## Documentation

- [Dashboard](../../docs/)
- [Chores](../../docs/)
- [Calendar](../../docs/)
- [AI Integration](../../docs/ai-integration.md)
