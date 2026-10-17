# 🚀 Deployment Guide - Masjid Management App

**Status**: ✅ Live in production
**Last Deployed**: 2026-07-28 (backend moved from Render to Vercel 2026-10)

---

## 🌐 Live URLs

| Service | URL | Platform |
|---|---|---|
| **Frontend** | https://masjid-management-omega.vercel.app | Vercel |
| **Backend API** | https://masjid-management-omega.vercel.app/api | Vercel (same project, serverless function) |
| **Database** | Neon Postgres (`neondb` project) | Neon |

> Until 2026-10 the backend ran on Render (https://angular-session.onrender.com, free Web Service, ~50 s cold start after 15 minutes idle). It moved to Vercel the same way the KMCC app runs: one Vercel project serves the frontend and `/api/*`. `render.yaml` and `server/index.js` are kept so the Render service can serve as a fallback until it is deleted.

---

## 🏗 Architecture

```
Browser
  │
  ▼
Vercel (masjid-management-omega.vercel.app)
  │  React + Vite static build      VITE_API_URL=/api (same domain)
  │  /api/* → api/index.js          one serverless function wrapping
  │                                 the Express app in server/app.js
  ▼
Neon (Postgres, serverless, free tier)
  transactions / users tables
```

---

## 🔑 Environment Variables

### Backend — set in Vercel dashboard → Project → Settings → Environment Variables, **Production** (and Preview if previews should work)
| Variable | Purpose | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Neon dashboard → Connection Details - use the **pooled** string (host has `-pooler`): serverless functions open many short connections |
| `JWT_SECRET` | Signs admin auth tokens | Generated once (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) — rotate in the Vercel env settings if ever exposed (changing it logs everyone out) |
| `FRONTEND_URL` | Restricts CORS to the deployed frontend (the frontend now calls its own domain, so CORS only matters for other callers) | Set to the Vercel production URL |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notification signing keypair (optional — app runs fine without these, just no reminders sent) | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Contact address push services may use to reach you about the keys, e.g. `mailto:you@example.com` | Pick one |
| `CRON_SECRET` | Shared secret the GitHub Actions daily reminder job sends as `x-cron-secret` to `/api/push/run-daily-check` and `/api/push/run-monthly-dues-check` | Generate a long random string, also add as a GitHub repo secret with the same value |
| `MASJID_AI_TOKEN` | Read-only access for the AI assistant: `/api/ai/*` (today's duty, schedule, members, the asking user's own record, pending dues, one year's dues (a member's own; the admin any member's, or everyone still owing that year), finance summary, transactions, announcements - no phones or addresses; answers follow the user's role: only the admin sees others' dues, the accounts and all transactions), sent as `Authorization: Bearer <token>`. Optional - unset, those endpoints answer 503 | Generate a long random string; the same value goes into the AI service's app entry (`MASJID_AI_TOKEN` in its `.env`) |
| `AI_ASK_URL`, `AI_ASK_KEY` | The Assistant chat for logged-in users: this server asks the AI service at `AI_ASK_URL` (e.g. `https://ai-engineer-api-jet.vercel.app/api/ask`) with this app's key `AI_ASK_KEY`, for one user at a time (a 5-minute read-only token, not their login). Optional - unset, the chat is hidden | The key comes from the AI service: `npm run app -- askkey new masjid` there (stored hashed in its Redis, works at once - no AI redeploy). Replacing it: make a new one, set it here and redeploy, then `askkey revoke <old id>` there |
| `TELEGRAM_BOT_TOKEN` | The assistant as a Telegram bot (`server/telegram.js`): the same answers, roles and daily limits as the app's chat. Members link by sharing their phone number with the bot (matched to their member record) or with a one-time link from Profile → Telegram; the admin links from Settings → Telegram; anyone else is a guest (food-duty schedule only). Private chats only; voice notes are turned into text. Needs `AI_ASK_URL`/`AI_ASK_KEY`. Optional - unset, `/api/telegram/*` answers 503 and the Telegram cards are hidden | In Telegram, message @BotFather: `/newbot`, pick a name and a username ending in `bot`; it gives the token. Set it here, redeploy, then Settings → Telegram → **Connect the bot** (points Telegram's webhook at this server; the webhook secret is derived from the token, nothing else to set). New token (`/revoke` in @BotFather): set it, redeploy, press Connect again |
| `AI_DAILY_LIMIT_MEMBER`, `AI_DAILY_LIMIT_GUEST`, `AI_DAILY_LIMIT_ADMIN` | Assistant questions per day (the masjid's day): per member (default 4), per IP address for visitors who are not logged in (default 4), for the admin (default 0 = no limit). Only the starting defaults: the admin changes the limits on the Settings page (Assistant card), stored in the database (`app_settings`) and used at once - no redeploy. Counted in Postgres (`assistant_usage`), so cold starts and redeploys don't reset them; a question the AI could not answer is not counted. Voice input is refused when none are left | Optional - the defaults apply when unset |

### Frontend — same Vercel project
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the backend API: `/api` (same domain - the API is in this project). Without it the build falls back to `http://<host>:5000/api`, the local dev server |

> `VITE_` prefixed vars are baked into the client bundle at build time and are visible to anyone visiting the site — never put secrets there.

### Local development
Copy the `.env.example` files and fill in real values — never commit `.env`:
```bash
cp masjid-management/server/.env.example masjid-management/server/.env
cp masjid-management/.env.example masjid-management/.env
```

---

## 🔁 Redeploying

- **Frontend and backend** deploy together: auto-deploys on every push to `main` via Vercel's GitHub integration (Project Settings → Root Directory = `masjid-management`) — this is the normal path, confirmed working as of 2026-07-25. Pushing to `main` is enough; no manual step needed. Manual redeploy (rarely needed): Vercel dashboard → Deployments → Redeploy, or:
  ```bash
  cd masjid-management
  npx vercel --prod
  ```
  > ⚠️ The manual CLI path and the git-triggered path don't mix well: the local `.vercel/project.json` link lives inside `masjid-management/`, so `vercel --prod` run from there already scopes to that folder — but Root Directory = `masjid-management` (needed for git-triggered deploys, which clone the full repo) makes the CLI look for a nonexistent nested `masjid-management/masjid-management`. Prefer git-push deploys; only use the CLI path if you first confirm Root Directory behavior for your case.
    - Env var changes only apply to the **next** deploy - redeploy after changing one.
  - A preview URL (`masjid-management-<hash>-<team>.vercel.app`) calls its own `/api`, which uses the **Preview** env vars - the same Neon database unless Preview has a different `DATABASE_URL`.

---

## 🩺 Health Checks

```bash
curl https://masjid-management-omega.vercel.app/api/auth/status
```

(`/health` is not routed on Vercel - only `/api/*` reaches the function; everything else is the frontend.) A Vercel cold start is about a second (it also runs `initializeDatabase()`, all `CREATE ... IF NOT EXISTS`). `500 FUNCTION_INVOCATION_FAILED` usually means a missing env var - without `JWT_SECRET` the app exits on purpose; Vercel → Deployments → the deploy → Logs shows why.

---

## ⚠️ Known Limitations / Follow-ups

- **Vercel Hobby limits**: function time per request (the assistant waits up to 120 s for the AI service - needs Fluid compute, the default for new projects, which allows 300 s), monthly invocations and bandwidth are ample for one masjid.
- **No admin account created yet** — the first visitor to the deployed site should go through the admin setup flow (`POST /api/auth/setup`, exposed via the app's UI) to create the first admin login.
- **API tokens used during setup** (Render API key, Vercel token) should be revoked/regenerated from their respective dashboards if you're done with one-off automation and want to reduce standing access.
- **Installed PWA / already-open tabs may lag behind a fresh deploy for a bit.** `src/main.tsx` forces a service-worker update check on load and on foreground/focus (see Troubleshooting Log below), but a genuinely offline device or a session that never regains focus won't reflect a new deploy until it does.
- **Push notifications require iOS 16.4+ AND the app added to the Home Screen** (standalone launch) — they silently do not work in a regular Safari tab. Android Chrome works more broadly. This is a platform limitation, not a bug.
- **The daily push-reminder jobs are triggered externally** by a GitHub Actions cron workflow (`.github/workflows/push-notification-reminders.yml`) calling `POST /api/push/run-daily-check` (food-day-before reminder) and `POST /api/push/run-monthly-dues-check` (month-end dues reminder - a no-op except on the last day of the month), not an in-process timer — a serverless function only runs while it answers a request, so there is no process to keep a timer in. The workflow calls the Vercel URL; the same `CRON_SECRET` must be in the Vercel env and in the GitHub repo secrets.
- **The admin Activity page's location column depends on `ip-api.com`** (free tier, no API key, HTTP-only — the outbound call to it is plain `http://`, not `https://`), called from `getIpGeo()` in `server/app.js`. No env var to configure; failures/rate-limiting just leave city/region/country `null` for that row (never blocks the request that triggered it). Results are cached in-memory per IP for the life of the process, so a cold start/redeploy clears the cache (more often on Vercel than on a long-lived process) and the next visit from each IP re-triggers one lookup. Location only ever resolves for real public-internet visitors — localhost/LAN IPs are always skipped.

---

## 🛠 Troubleshooting Log

### Issue (Render, before the move): `npm error Missing script: "start"`
- **Cause**: the Render service's Root Directory was pointed at the repo/frontend root instead of `masjid-management/server`, so it ran the frontend's `package.json` (no `start` script) instead of the backend's.
- **Fix**: Render dashboard → service → Settings → Build & Deploy → set Root Directory to `masjid-management/server`, Build Command to `npm install`, Start Command to `npm start`.

### Issue: Vercel build fails with `sh: line 1: vite: command not found` / `Error: Command "vite build" exited with 127`
- **Cause**: Vercel's project **Root Directory** was set to `./` (repo root) instead of `masjid-management`. Git-triggered deploys clone the *entire* repo, so with Root Directory unset it tried to install/build at the repo root, which has no `package.json` at all (only `masjid-management/package.json` has `vite`) — hence no install step ran and `vite` was never found. This looked like a stale-build-cache issue at first (identical cache ID kept getting restored across deploys), but disabling cache entirely reproduced the exact same failure, which ruled that out and pointed at Root Directory instead.
- **Fix**: Vercel dashboard → Settings → Root Directory → set to `masjid-management` → Save → redeploy.
- Two smaller contributing fixes also landed alongside this (harmless either way, kept as belt-and-suspenders): `masjid-management/.npmrc` (`production=false`, forces devDependencies to install regardless of `NODE_ENV`) and `masjid-management/vercel.json` (`installCommand: npm ci`, forces a deterministic clean install).

### Issue: CORS error on a freshly deployed frontend (`... has been blocked by CORS policy`)
- *(From the Render days - the frontend now calls its own domain, so this no longer happens.)*
- **Cause**: opening a Vercel **per-deployment preview URL** (e.g. `masjid-management-<hash>-<team>.vercel.app`, the unique URL Vercel generates for every single build) instead of the stable production domain. The backend's `FRONTEND_URL` CORS allow-list is an exact string match against the production URL only.
- **Fix**: always use `https://masjid-management-omega.vercel.app` to browse the live app, not a deployment-specific URL.

---

## 📦 Stack Summary

| Piece | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel | Free tier, auto HTTPS, auto-deploys on `git push` via GitHub integration |
| Backend hosting | Vercel Function (same project) | No cold-start wait like Render's free tier, one deploy for both sides, same setup as the KMCC app |
| Database | Neon (Postgres, free tier) | Serverless Postgres, no card required, survives redeploys (unlike SQLite on ephemeral disk) |
