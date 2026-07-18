# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo is the parent of a single app, `masjid-management/`, a full-stack financial tracker (income/expense ledger with charts) for a masjid. There is no monorepo tooling (no workspaces) — the frontend and backend are two independently-run Node projects in the same folder tree:

- `masjid-management/` — React + TypeScript + Vite frontend
- `masjid-management/server/` — Express + Postgres backend
- `render.yaml` (repo root) — Render Blueprint for the backend; `rootDir: masjid-management/server`
- `DEPLOYMENT.md` — live production URLs, env vars, redeploy commands, troubleshooting log
- `MASJID_APP_DOCUMENTATION.md` — API/schema/component reference

Read `DEPLOYMENT.md` before touching hosting/env config — it documents the actual deployed state (Vercel + Render + Neon), not just intent.

## Commands

Run frontend and backend as two separate processes; there's no root-level script that starts both.

```bash
# Frontend (masjid-management/)
npm run dev       # Vite dev server on :5173 (--host, so it's LAN-reachable)
npm run build     # tsc -b && vite build
npm run lint      # oxlint
npm run preview

# Backend (masjid-management/server/)
npm run dev       # node --watch index.js on :5000
npm start         # node index.js (production)
```

No test suite exists in either project — there is no `test` script and no test files. Don't assume Jest/Vitest config exists.

Backend requires a `.env` (see `server/.env.example`): `DATABASE_URL` (Postgres/Neon), `JWT_SECRET`, `FRONTEND_URL` (CORS allow-list), `PORT`. Frontend optionally reads `VITE_API_URL` at build time (see `.env.example`); without it, it falls back to `http://<current-hostname>:5000/api`, which only works when frontend and backend share a host (LAN dev).

## Architecture

**Single-file backend.** All API routes, DB init, and middleware live in `server/index.js` — no router/controller/model split. `dbRun`/`dbAll`/`dbGet` are thin wrappers around a single `pg.Pool`. Tables (`transactions`, `users`) are created with `CREATE TABLE IF NOT EXISTS` on server startup (`initializeDatabase()`), not via migrations.

**Auth is a single hardcoded admin account, not multi-user.** `POST /api/auth/setup` only succeeds once (while `users` table is empty) to create the sole admin; after that it's login-only. `requireAdmin` middleware checks a JWT bearer token for all write endpoints (`POST`/`PUT`/`DELETE` on `/api/transactions*`). Read endpoints (`GET /api/transactions`, `/api/summary`, etc.) are public/unauthenticated — anyone can view financial data, only admin can modify it.

**Date filtering pitfall:** the `date` column is `TEXT`, and rows may contain either a plain `YYYY-MM-DD` string or a full ISO timestamp (created transactions use `new Date().toISOString()`). Range queries must cast both sides: `date::date BETWEEN $1::date AND $2::date` (see `dateRangeClause()` in `index.js`) — a plain string `BETWEEN` comparison silently excludes today's timestamped rows because of lexicographic string comparison. Any new date-range query must use the same cast.

**Frontend state**: two React contexts wrap the whole app (`main.tsx`): `SettingsProvider` (theme + currency, persisted to `localStorage`, no backend calls) and `AuthProvider` (JWT + username in `localStorage`, wraps the auth API calls). `App.tsx` does manual view-switching via a `activeKey` string state (`dashboard`/`transactions`/`members`/`yearly-schedule`/`settings`) rendered through a `switch` — there's no router library. The `transactions` menu item/route is only included/rendered when `isAdmin` is true, with a `useEffect` that redirects `activeKey` back to `dashboard` if an admin logs out mid-view.

**Dashboard admin gating is UI-only, not a real permission boundary.** In `Dashboard.tsx`, the income/expense/balance cards, quick stats, charts, and date-range picker only render for `isAdmin`; non-admins see just the `TodayAssignmentCard` plus a "log in as admin" prompt. The `getSummary()` fetch itself is also skipped for non-admins (to avoid an unnecessary loading spinner/error state hiding that content), but since `GET /api/summary` remains a public/unauthenticated backend endpoint, this only changes what's rendered in this one component — the underlying data is still fetchable directly by anyone. Don't treat this pattern as a substitute for backend authorization; if financial data ever needs real access control, it has to move to `requireAdmin` on the backend route.

**API client** (`src/services/api.ts`) is the only place that calls `fetch` — components never call `fetch` directly. All transaction/auth types are defined there and re-exported.

**Mobile layout is a recurring pain point in this codebase.** Several components (`Dashboard.tsx`, `TransactionsList.tsx`, `TransactionForm.tsx`, `App.tsx`) have had repeated mobile-breakpoint bugs: header rows collapsing into columns and pushing buttons out of place, text-labeled buttons overflowing/wrapping instead of shrinking. The established pattern for fixing these: keep header rows as `flex` with `justify-content: space-between` (don't switch to `flex-direction: column` on mobile), and collapse icon+text buttons to icon-only circular buttons below a breakpoint (see `.dashboard-add-btn`, `.add-transaction-btn` + `.add-transaction-btn-label` in the respective CSS files) rather than shrinking or wrapping the text. When touching any of these components' CSS, check behavior at both ~375px and ~768px before considering it done.

## Deployment

Production stack: Vercel (frontend, static Vite build) + Render (backend, free Web Service) + Neon (Postgres, free tier). Full details, live URLs, and required env vars are in `DEPLOYMENT.md` — check it first rather than re-deriving the setup. Notably:
- Backend auto-deploys from GitHub pushes to `main` (Render webhook already configured).
- Frontend does **not** auto-deploy from git — it's deployed manually via `vercel --prod` from `masjid-management/`.
