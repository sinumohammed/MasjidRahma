# 🚀 Deployment Guide - Masjid Management App

**Status**: ✅ Live in production
**Last Deployed**: 2026-07-18

---

## 🌐 Live URLs

| Service | URL | Platform |
|---|---|---|
| **Frontend** | https://masjid-management-omega.vercel.app | Vercel |
| **Backend API** | https://angular-session.onrender.com | Render (free Web Service) |
| **Database** | Neon Postgres (`neondb` project) | Neon |

> The backend's Render service display name is `masjid-management-api`, but its URL still uses the slug `angular-session` from before it was renamed — cosmetic only, doesn't affect anything. Renaming the slug itself isn't supported without recreating the service.

---

## 🏗 Architecture

```
Browser
  │
  ▼
Vercel (masjid-management-omega.vercel.app)
  │  React + Vite static build
  │  VITE_API_URL → points at Render backend
  ▼
Render (angular-session.onrender.com)
  │  Express API (masjid-management/server)
  │  CORS locked to FRONTEND_URL
  ▼
Neon (Postgres, serverless, free tier)
  transactions / users tables
```

---

## 🔑 Environment Variables

### Backend (Render) — set in Render dashboard → Environment tab
| Variable | Purpose | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Neon dashboard → Connection Details |
| `JWT_SECRET` | Signs admin auth tokens | Generated once (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) — rotate via Render dashboard if ever exposed |
| `FRONTEND_URL` | Restricts CORS to the deployed frontend | Set to the Vercel production URL |
| `PORT` | Injected automatically by Render | No action needed |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notification signing keypair (optional — app runs fine without these, just no reminders sent) | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Contact address push services may use to reach you about the keys, e.g. `mailto:you@example.com` | Pick one |
| `CRON_SECRET` | Shared secret the GitHub Actions daily reminder job sends as `x-cron-secret` to `/api/push/run-daily-check` | Generate a long random string, also add as a GitHub repo secret with the same value |

### Frontend (Vercel) — set in Vercel dashboard → Project → Settings → Environment Variables
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Full base URL of the backend API, e.g. `https://angular-session.onrender.com/api` |

> `VITE_` prefixed vars are baked into the client bundle at build time and are visible to anyone visiting the site — never put secrets there.

### Local development
Copy the `.env.example` files and fill in real values — never commit `.env`:
```bash
cp masjid-management/server/.env.example masjid-management/server/.env
cp masjid-management/.env.example masjid-management/.env
```

---

## 🔁 Redeploying

- **Backend**: auto-deploys on every push to `main` (Render's `autoDeploy` is on). Manual trigger: Render dashboard → Manual Deploy, or via API:
  ```bash
  curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
    https://api.render.com/v1/services/srv-d1dqi3h5pdvs73arktsg/deploys -d '{}'
  ```
- **Frontend**: auto-deploys on every push to `main` via Vercel's GitHub integration (Project Settings → Root Directory = `masjid-management`). Manual redeploy: Vercel dashboard → Deployments → Redeploy, or:
  ```bash
  cd masjid-management
  npx vercel --prod
  ```
  > ⚠️ The manual CLI path and the git-triggered path don't mix well: the local `.vercel/project.json` link lives inside `masjid-management/`, so `vercel --prod` run from there already scopes to that folder — but Root Directory = `masjid-management` (needed for git-triggered deploys, which clone the full repo) makes the CLI look for a nonexistent nested `masjid-management/masjid-management`. Prefer git-push deploys; only use the CLI path if you first confirm Root Directory behavior for your case.
  - **Always use the stable production URL** (`https://masjid-management-omega.vercel.app`), not a deployment-specific preview URL (e.g. `masjid-management-<hash>-<team>.vercel.app`) — the backend's `FRONTEND_URL` CORS allow-list only matches the production domain, so preview URLs will fail with a CORS error even though the app itself deployed fine.

---

## 🩺 Health Checks

```bash
curl https://angular-session.onrender.com/health
curl https://angular-session.onrender.com/api/auth/status
```

Render's free tier sleeps after ~15 minutes of inactivity — the first request after idle takes 30-50s to wake up. This is expected free-tier behavior, not a bug.

---

## ⚠️ Known Limitations / Follow-ups

- **Render free tier**: cold starts after idle, limited monthly hours. Fine for low-traffic use; upgrade to a paid instance if the masjid needs always-on availability.
- **No admin account created yet** — the first visitor to the deployed site should go through the admin setup flow (`POST /api/auth/setup`, exposed via the app's UI) to create the first admin login.
- **API tokens used during setup** (Render API key, Vercel token) should be revoked/regenerated from their respective dashboards if you're done with one-off automation and want to reduce standing access.
- **Installed PWA / already-open tabs may lag behind a fresh deploy for a bit.** `src/main.tsx` forces a service-worker update check on load and on foreground/focus (see Troubleshooting Log below), but a genuinely offline device or a session that never regains focus won't reflect a new deploy until it does.
- **Push notifications require iOS 16.4+ AND the app added to the Home Screen** (standalone launch) — they silently do not work in a regular Safari tab. Android Chrome works more broadly. This is a platform limitation, not a bug.
- **The daily food-day-reminder job is triggered externally** by a GitHub Actions cron workflow (`.github/workflows/food-day-reminders.yml`) calling `POST /api/push/run-daily-check`, not an in-process timer — Render's free tier can sleep, so an in-process scheduler would be unreliable.

---

## 🛠 Troubleshooting Log

### Issue: `npm error Missing script: "start"` on Render
- **Cause**: the Render service's Root Directory was pointed at the repo/frontend root instead of `masjid-management/server`, so it ran the frontend's `package.json` (no `start` script) instead of the backend's.
- **Fix**: Render dashboard → service → Settings → Build & Deploy → set Root Directory to `masjid-management/server`, Build Command to `npm install`, Start Command to `npm start`.

### Issue: Vercel build fails with `sh: line 1: vite: command not found` / `Error: Command "vite build" exited with 127`
- **Cause**: Vercel's project **Root Directory** was set to `./` (repo root) instead of `masjid-management`. Git-triggered deploys clone the *entire* repo, so with Root Directory unset it tried to install/build at the repo root, which has no `package.json` at all (only `masjid-management/package.json` has `vite`) — hence no install step ran and `vite` was never found. This looked like a stale-build-cache issue at first (identical cache ID kept getting restored across deploys), but disabling cache entirely reproduced the exact same failure, which ruled that out and pointed at Root Directory instead.
- **Fix**: Vercel dashboard → Settings → Root Directory → set to `masjid-management` → Save → redeploy.
- Two smaller contributing fixes also landed alongside this (harmless either way, kept as belt-and-suspenders): `masjid-management/.npmrc` (`production=false`, forces devDependencies to install regardless of `NODE_ENV`) and `masjid-management/vercel.json` (`installCommand: npm ci`, forces a deterministic clean install).

### Issue: CORS error on a freshly deployed frontend (`... has been blocked by CORS policy`)
- **Cause**: opening a Vercel **per-deployment preview URL** (e.g. `masjid-management-<hash>-<team>.vercel.app`, the unique URL Vercel generates for every single build) instead of the stable production domain. The backend's `FRONTEND_URL` CORS allow-list is an exact string match against the production URL only.
- **Fix**: always use `https://masjid-management-omega.vercel.app` to browse the live app, not a deployment-specific URL.

---

## 📦 Stack Summary

| Piece | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel | Free tier, auto HTTPS, simple CLI deploy |
| Backend hosting | Render (free Web Service) | Free tier, deploys from GitHub, supports env vars |
| Database | Neon (Postgres, free tier) | Serverless Postgres, no card required, survives redeploys (unlike SQLite on ephemeral disk) |
