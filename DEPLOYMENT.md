# 🚀 Deployment Guide - Masjid Management App

**Status**: ✅ Live in production
**Last Deployed**: 2026-07-13

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
- **Frontend**: currently deployed via `vercel --prod` from the CLI (not yet wired to auto-deploy on git push). To redeploy:
  ```bash
  cd masjid-management
  npx vercel --prod
  ```
  To enable auto-deploy on push instead, connect the `sinumohammeds-projects/masjid-management` Vercel project to the GitHub repo from the Vercel dashboard (Project → Settings → Git).

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
- **Vercel auto-deploy not connected to GitHub** — currently manual (`vercel --prod`). Connect the Git integration in the Vercel dashboard if you want push-to-deploy.
- **API tokens used during setup** (Render API key, Vercel token) should be revoked/regenerated from their respective dashboards if you're done with one-off automation and want to reduce standing access.

---

## 🛠 Troubleshooting Log

### Issue: `npm error Missing script: "start"` on Render
- **Cause**: the Render service's Root Directory was pointed at the repo/frontend root instead of `masjid-management/server`, so it ran the frontend's `package.json` (no `start` script) instead of the backend's.
- **Fix**: Render dashboard → service → Settings → Build & Deploy → set Root Directory to `masjid-management/server`, Build Command to `npm install`, Start Command to `npm start`.

---

## 📦 Stack Summary

| Piece | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel | Free tier, auto HTTPS, simple CLI deploy |
| Backend hosting | Render (free Web Service) | Free tier, deploys from GitHub, supports env vars |
| Database | Neon (Postgres, free tier) | Serverless Postgres, no card required, survives redeploys (unlike SQLite on ephemeral disk) |
