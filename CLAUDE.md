# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Start server on port 3000 (or $PORT)
npm install      # Install dependencies (node-schedule, express, uuid)
```

No test framework is configured.

## Architecture

**Signal Scheduler** is a monolithic full-stack webhook scheduling app:

- **`index.js`** — Express server, all API routes, schedule persistence, and webhook triggering via `node-schedule`. Reads/writes `schedules.json` and `logs.json` for state.
- **`public/`** — Vanilla JS frontend (no framework). `script.js` manages all state and API calls; `index.html` contains card/form templates rendered client-side.

### Data Flow

All schedules are stored in `schedules.json` (flat JSON). On server start, schedules are loaded and re-registered with `node-schedule`. When a job fires, it POSTs to the configured webhook URL and appends to `logs.json` (capped at 50 entries).

### Scheduling Types

`once`, `minutes`, `hours`, `daily`, `weekly` — all with an optional `startAt` for initial delay on recurring runs.

**Timezone is hardcoded to UTC+7 (Asia/Ho_Chi_Minh)** for daily/weekly schedule calculations.

### API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/schedules` | List all schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:id` | Update schedule |
| PUT | `/api/schedules/:id/toggle` | Toggle active state |
| DELETE | `/api/schedules/:id` | Delete schedule |
| GET | `/api/logs` | Last 50 execution logs |
| DELETE | `/api/logs` | Clear logs |

### Deployment

Configured for Replit/Google Cloud Run. The `PORT` environment variable controls the listening port.
