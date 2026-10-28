import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import { waitUntil } from '@vercel/functions';
import { AI_OPENAPI } from './aiOpenapi.js';
import { aiMcpHandler } from './aiMcp.js';
import { findMembers, toLatin } from './nameMatch.js';
import { telegramRouter } from './telegram.js';
import { handoverApi, handoverRouter, HANDOVER_PERSON } from './handover.js';

// Load server/.env by absolute path rather than relying on dotenv's default
// (relative to process.cwd()) - the local/Render entry (server/index.js) and
// the Vercel serverless entry (../api/index.js) run with different working
// directories, but both import this file from the same location, so this is
// the one path that resolves correctly either way. On Vercel itself this is
// a no-op (no .env file is deployed - real env vars come from the project's
// Environment Variables settings instead), which dotenv.config() handles
// silently when the target file doesn't exist.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const { Pool } = pg;
const app = express();
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const CRON_SECRET = process.env.CRON_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

// Push notifications are optional - unlike JWT_SECRET, the app must still run
// without them (just no reminders sent), so misconfiguration here can only
// ever warn and disable push, never crash the whole server on startup.
let pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    pushEnabled = false;
    console.warn(`Invalid VAPID configuration, push notifications are disabled: ${err.message}`);
  }
} else {
  console.warn('VAPID keys not configured - push notifications are disabled.');
}

// Runs work after a response has already been sent (push notifications, IP
// geo enrichment). On Vercel, the function's execution can be frozen the
// instant the response flushes, so a plain unawaited promise can get cut off
// mid-flight - waitUntil() tells the platform to keep the invocation alive
// until the promise settles. Outside Vercel (local dev, Render's persistent
// process) there's no such freeze, so it falls back to the old fire-and-forget
// behavior; calling waitUntil() there would throw since there's no request
// context for it to hook into.
function runInBackground(promise) {
  if (process.env.VERCEL) {
    waitUntil(promise);
  } else {
    promise.catch((err) => console.warn(`Background task failed: ${err.message}`));
  }
}

// Render sits behind a reverse proxy - without this, req.ip is always the
// proxy's address instead of the visitor's, breaking IP-based geolocation.
// Vercel Functions also sit behind a proxy, so this applies there too.
app.set('trust proxy', true);

// Middleware
app.use(cors(FRONTEND_URL ? { origin: FRONTEND_URL } : {}));
// 1 MB: room for a photo in About the masjid (resized in the browser to
// ~100 KB first); everything else is far smaller.
app.use(express.json({ limit: '1mb' }));

// Postgres connection (Neon requires SSL; local Postgres typically doesn't)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

// Neon (and Postgres generally) can drop an idle connection at any time
// (e.g. Neon's serverless tier closes idle connections after inactivity).
// pg's Pool emits 'error' on the pool itself when that happens to a client
// sitting idle in the pool - without a listener here, Node's default
// behavior for an unhandled EventEmitter 'error' is to throw and crash the
// whole process. The pool recovers the connection on its own; this only
// needs to stop that crash.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client:', err.message);
});

// Initialize database tables
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      unique_id TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      member_count INTEGER NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Additive migration for members created before the phone column existed.
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`);

  // Members log in with their own users row (username = unique_id, password
  // validated live against members.phone - no stored hash, so editing phone
  // via the admin form updates login with no sync code). is_admin distinguishes
  // the single admin account from member accounts in the same table.
  await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE users ALTER COLUMN is_admin SET DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id TEXT REFERENCES members(id)`);

  // Optional recurring payment plan per member, used to compute dues.
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_amount NUMERIC`);
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_frequency TEXT`);

  // 'regular' members participate in the food-supply rotation (yearly
  // schedule, today's/tomorrow's assignment, swaps); 'non_rotation' members
  // are managed the same as any other member (payments, profile, etc.) but
  // are never assigned food duty - see getActiveMembersOrdered().
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'regular'`);

  // Optional admin-set override for when a monthly payer's dues actually
  // start (year + 0-indexed month). Null means "no override" - dues math
  // keeps its default behavior of reckoning every year from January
  // (calculateDues/buildMonthlyBreakdown). Set this when a member only
  // actually started partway through a year, so earlier months show as
  // 'nil' (not owed) instead of 'missed' - without needing a matching
  // transaction to fake it as paid.
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_start_year INTEGER`);
  await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_start_month INTEGER`);

  // Optional link from a transaction to the member it's attributed to.
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS member_id TEXT REFERENCES members(id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rotation_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      cycle_start_date TEXT NOT NULL,
      cycle_member_ids TEXT NOT NULL,
      cycle_number INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_overrides (
      date TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id),
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // A member can have multiple devices subscribed (member_id not unique);
  // endpoint identifies a single device's subscription and is unique so
  // re-subscribing the same device upserts rather than duplicating.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Editable Settings > Help contact entries (Masjid Committee, Muaddin,
  // Site Related Queries) - group_key identifies which list a row belongs
  // to; position controls display order within that group.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      group_key TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // History of broadcast announcements, so members can read them inside the
  // app after tapping a push notification (not just as a fire-and-forget
  // push payload).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Individual, per-member notifications (payment received, dues reminder,
  // food-day reminder) - deliberately a separate table from `announcements`
  // so one member's personal notices are never visible to another member;
  // `announcements` stays exclusively for admin broadcasts to everyone.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_notifications (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Admin-visible usage timeline: login/logout events and view/page visits,
  // from both logged-in and anonymous visitors. IP is only used to derive a
  // best-effort city/region/country (via getIpGeo's cache) and is not
  // exposed to the frontend on its own.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      path TEXT,
      username TEXT,
      is_admin BOOLEAN,
      member_id TEXT REFERENCES members(id),
      ip TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      browser TEXT,
      os TEXT,
      device_type TEXT,
      is_pwa BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Bank/committee accounts that hold the masjid's actual cash - a
  // transaction's bank_id attributes it to one of these so each account's
  // balance can be tracked separately, not just the org-wide total.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      opening_balance NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Nullable - transactions recorded before this feature existed have no
  // bank attributed (their value is already baked into the seeded opening
  // balances below), only new transactions require one (enforced in
  // POST/PUT /api/transactions).
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_id TEXT REFERENCES banks(id)`);

  // Assistant questions per user per day (the masjid's day) - the daily
  // limit survives restarts and Render's free-tier sleep. user_key is the
  // user id, or "ip:<address>" for a visitor who is not logged in.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assistant_usage (
      user_key TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_key, day)
    )
  `);

  // Settings the admin changes in the app (Settings page) - today only the
  // Assistant's daily question limits. key -> value as text.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Personal tokens for MCP clients such as Claude Code (/api/ai/mcp): made
  // by the admin in Settings, shown once, stored only as a SHA-256 hash.
  // Deleting the row revokes the token at once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      hint TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP
    )
  `);

  // Chat channels for the assistant (telegram.js; WhatsApp later): which
  // masjid login a chat account asks as. external_id is the channel's own
  // id (the Telegram user id). A link is made by the person themselves - a
  // one-time code from the app, or sharing their own phone number with the
  // bot - and deleted with the user.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_links (
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel, external_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_link_codes (
      code_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMP NOT NULL
    )
  `);
  // Per chat account: the voice-note language. Kept for guests too.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_prefs (
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      voice_language TEXT,
      PRIMARY KEY (channel, external_id)
    )
  `);
  // Telegram updates already handled - it sends one again when our answer
  // to its webhook is lost, and a question must not be answered twice.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id BIGINT PRIMARY KEY,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // About the masjid (Settings, admin; shown to everyone): the people behind
  // it - founders and today's president, imam, muaddin... - with a photo
  // each (a data URL, resized in the browser), in the admin's order. The
  // story, founding year and address are app_settings 'about.*'.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masjid_people (
      id TEXT PRIMARY KEY,
      group_key TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      since TEXT NOT NULL DEFAULT '',
      photo TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Member photos uploaded in the app (the member's edit form), apart from
  // members so the member lists never carry them. Before this, photos were
  // files in public/assets/members/ - still shown when no upload exists.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_photos (
      member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      photo TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database tables ready');
  await backfillMemberUsers();
  await seedDefaultContacts();
  await seedDefaultBanks();
}

// One-time seed of the Settings > Help contacts, matching what was
// previously hardcoded in the frontend - only runs if the table is empty,
// so it never overwrites contacts an admin has since edited.
async function seedDefaultContacts() {
  const existing = await dbGet('SELECT 1 FROM contacts LIMIT 1');
  if (existing) return;
  const defaults = [
    { group_key: 'committee', name: 'Moideen Kutty', phone: '9539 602 550', position: 0 },
    { group_key: 'committee', name: 'Kunjan Pynat', phone: '9846 006 759', position: 1 },
    { group_key: 'muaddin', name: 'Muaddin', phone: '9745 283 681', position: 0 },
    { group_key: 'muaddin', name: 'Muaddin 2', phone: null, position: 1 },
    { group_key: 'query', name: 'Sinu', phone: '9947 500 525', position: 0 },
  ];
  for (const contact of defaults) {
    await dbRun(
      'INSERT INTO contacts (id, group_key, name, phone, position) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), contact.group_key, contact.name, contact.phone, contact.position]
    );
  }
}

// One-time seed of the two starting bank/committee accounts, with their
// real-world balance as of when this feature was introduced set as the
// opening balance - only runs if the table is empty, so it never overwrites
// an admin's later edits.
async function seedDefaultBanks() {
  const existing = await dbGet('SELECT 1 FROM banks LIMIT 1');
  if (existing) return;
  const defaults = [
    { name: 'Bank', opening_balance: 85688 },
    { name: 'Committee', opening_balance: 5696 },
  ];
  for (const bank of defaults) {
    await dbRun(
      'INSERT INTO banks (id, name, opening_balance) VALUES ($1, $2, $3)',
      [uuidv4(), bank.name, bank.opening_balance]
    );
  }
}

// Creates a users row (is_admin=false) for any member that predates this
// feature or was otherwise never paired with a login - idempotent, safe to
// run on every boot.
async function backfillMemberUsers() {
  const members = await dbAll('SELECT id, unique_id FROM members');
  for (const member of members) {
    const existing = await dbGet('SELECT 1 FROM users WHERE member_id = $1', [member.id]);
    if (existing) continue;
    const usernameTaken = await dbGet('SELECT 1 FROM users WHERE username = $1', [member.unique_id]);
    if (usernameTaken) continue;
    await dbRun(
      'INSERT INTO users (id, username, password_hash, is_admin, member_id) VALUES ($1, $2, NULL, false, $3)',
      [uuidv4(), member.unique_id, member.id]
    );
  }
}

initializeDatabase().catch((err) => console.error('Error initializing database:', err));

// Helper functions to run database queries
function dbRun(query, params = []) {
  return pool.query(query, params);
}

async function dbAll(query, params = []) {
  const result = await pool.query(query, params);
  return result.rows;
}

async function dbGet(query, params = []) {
  const result = await pool.query(query, params);
  return result.rows[0];
}

// Auth middleware
function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

// Any valid token (admin or member) - used by endpoints a logged-in member
// may call for their own data.
function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// Like requireAuth, but never rejects - anonymous visitors are expected
// (used by the activity-log endpoint, which logs both logged-in and
// anonymous page visits). req.user is set when a valid token is present.
function optionalAuth(req, res, next) {
  const token = getBearerToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // Ignore invalid/expired token - treat as anonymous rather than failing the request.
    }
  }
  next();
}

// Build an optional WHERE clause for date-range filtering
function dateRangeClause(req) {
  const { startDate, endDate } = req.query;
  // Cast to date so this matches regardless of whether stored `date` values
  // are plain YYYY-MM-DD strings or full ISO timestamps (e.g. today's entries).
  if (startDate && endDate) {
    return { clause: 'WHERE date::date BETWEEN $1::date AND $2::date', params: [startDate, endDate] };
  }
  if (startDate) {
    return { clause: 'WHERE date::date >= $1::date', params: [startDate] };
  }
  if (endDate) {
    return { clause: 'WHERE date::date <= $1::date', params: [endDate] };
  }
  return { clause: '', params: [] };
}

// --- Activity/usage tracking helpers ---

// Minimal, dependency-free UA parsing - good enough for "how are people
// accessing this" analytics, not meant to be exhaustive.
function parseUserAgent(ua) {
  if (!ua) return { browser: null, os: null, deviceType: null };

  let os = null;
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = null;
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/crios\//i.test(ua)) browser = 'Chrome';
  else if (/fxios\//i.test(ua)) browser = 'Firefox';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  const deviceType = /mobile|iphone|android/i.test(ua) && !/ipad|tablet/i.test(ua)
    ? 'mobile'
    : /ipad|tablet/i.test(ua)
      ? 'tablet'
      : 'desktop';

  return { browser, os, deviceType };
}

// City/region/country lookup for an IP, backed by an in-memory cache so
// repeat visitors (the overwhelming majority of traffic here) never hit the
// external API more than once. Best-effort only: any failure (rate limit,
// network error, private/local IP) just leaves the geo fields null - this
// must never block or fail the request that triggered it. Note: on Vercel,
// each cold-started instance gets its own empty cache, so this is far less
// effective there than on a long-lived Render process - acceptable since
// lookups are still best-effort and never block the response.
const ipGeoCache = new Map();

async function getIpGeo(ip) {
  if (!ip) return null;
  const normalizedIp = ip.replace('::ffff:', '');
  if (normalizedIp === '::1' || normalizedIp === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(normalizedIp)) {
    return null;
  }
  if (ipGeoCache.has(normalizedIp)) {
    return ipGeoCache.get(normalizedIp);
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(normalizedIp)}?fields=status,country,regionName,city`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`geo lookup failed: ${response.status}`);
    const data = await response.json();
    const geo = data.status === 'success'
      ? { city: data.city || null, region: data.regionName || null, country: data.country || null }
      : null;
    ipGeoCache.set(normalizedIp, geo);
    return geo;
  } catch (err) {
    console.warn(`IP geolocation lookup failed for ${normalizedIp}: ${err.message}`);
    ipGeoCache.set(normalizedIp, null);
    return null;
  }
}

// --- Members / food-supply rotation helpers ---

// The masjid's physical location, used to determine what calendar day
// "today" is. The rotation must flip over at this timezone's local midnight,
// not at UTC midnight (which would run hours behind/ahead of the masjid's
// actual day depending on where the server happens to be hosted).
const MASJID_TIMEZONE = 'Asia/Kolkata';
const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: MASJID_TIMEZONE });

function todayInMasjidTimezone() {
  return todayFormatter.format(new Date());
}

// Year/month parts of a date in the masjid's timezone - used for dues math,
// which needs calendar-month granularity, not just a date string. Reading
// year/month with plain getUTC*() would disagree with this near midnight
// (Kolkata is always ahead of UTC), so every "which month is this in" check
// must go through this same Intl-based conversion.
function getMasjidYearMonth(date) {
  const [year, month] = todayFormatter.format(date).split('-').map(Number);
  return { year, monthIndex: month - 1 };
}

function getMasjidTodayParts() {
  return getMasjidYearMonth(new Date());
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetweenDates(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00Z');
  const to = new Date(toDateStr + 'T00:00:00Z');
  return Math.round((to - from) / 86400000);
}

// Only 'regular' members are eligible for the food-supply rotation - this is
// the single source of truth every rotation/schedule computation reads from
// (ensureRotationState, advanceRotationIfNeeded, getRotationProjectionContext,
// set-current), so a 'non_rotation' member is automatically excluded from
// the yearly schedule and today's/tomorrow's assignment everywhere at once.
async function getActiveMembersOrdered() {
  return dbAll("SELECT * FROM members WHERE active = true AND member_type = 'regular' ORDER BY position ASC");
}

// Resolves how many of a given year's 12 months a monthly payer actually
// owes, given their optional dues_start_year/dues_start_month override (see
// the members table migration comment). Returns 0-12: 12 means "not
// obligated for any month of this year" (year is entirely before the
// start), 0 means "no override, or the override year has already passed"
// (i.e. the whole year is owed from January as before).
function resolveDuesStartMonthIndexForYear(member, year) {
  if (member.dues_start_year == null || member.dues_start_month == null) return 0;
  if (year < member.dues_start_year) return 12;
  if (year === member.dues_start_year) return member.dues_start_month;
  return 0;
}

// Computes a yearly-plan member's recurring-payment standing (monthly plans
// go through computeMonthlyBreakdownForYear/computeCurrentDuesAndBreakdown
// instead, which also resolve the dues_start override for month-level
// coverage). `today` is { year, monthIndex } in the masjid's timezone.
// Yearly plans count lifetime periods since a start point, normally the
// member's created_at, but an admin-set dues_start override (if set) takes
// precedence - e.g. a member added to the system late but who actually
// started paying (or should start being counted) from an earlier or later
// year/month than created_at. The current in-progress period already
// counts as owed (matches "pay at start of period").
function calculateDues(member, paid, today) {
  if (member.payment_amount == null || !member.payment_frequency) {
    return { hasPlan: false, expected: null, paid, due: null, periodsOwed: null };
  }
  const start =
    member.dues_start_year != null && member.dues_start_month != null
      ? { year: member.dues_start_year, monthIndex: member.dues_start_month }
      : getMasjidYearMonth(new Date(member.created_at));
  const rawMonthsElapsed = (today.year - start.year) * 12 + (today.monthIndex - start.monthIndex) + 1;
  const monthsElapsed = Math.max(rawMonthsElapsed, 0);
  const periodsOwed = Math.ceil(monthsElapsed / 12);
  const expected = Number(member.payment_amount) * periodsOwed;
  return { hasPlan: true, expected, paid, due: expected - paid, periodsOwed };
}

// Sums a member's "Masjid payment" income, scoped to match what calculateDues
// actually measures against: monthly plans reset `expected` to just this
// year's months every January (see calculateDues above), so `paid` must be
// scoped to the current year too - otherwise a prior year's payment silently
// offsets this year's due (e.g. a 2025 payment making 2026 look more caught
// up than it is). Yearly plans are intentionally lifetime-cumulative (their
// `expected` also accumulates since join), so paid stays lifetime there.
async function getMemberMasjidPaymentTotal(member, today) {
  if (member.payment_frequency === 'monthly') {
    return getMemberMasjidPaymentTotalForYear(member, today.year);
  }
  const paidRow = await dbGet(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE member_id = $1 AND category = 'Masjid payment' AND type = 'income'`,
    [member.id]
  );
  return Number(paidRow.total);
}

// Same as the monthly branch of getMemberMasjidPaymentTotal above, but for an
// arbitrary calendar year - used to check a monthly payer's prior-year
// standing (e.g. last year's missed months) in addition to the current year.
async function getMemberMasjidPaymentTotalForYear(member, year) {
  const paidRow = await dbGet(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE member_id = $1 AND category = 'Masjid payment' AND type = 'income'
     AND date::date BETWEEN $2::date AND $3::date`,
    [member.id, `${year}-01-01`, `${year}-12-31`]
  );
  return Number(paidRow.total);
}

// Lifetime sum from a member's dues_start override onward (year/month, day
// 1) - used by resolveMonthlyCoverage's override branch to fill months
// sequentially from dues_start regardless of which calendar year each
// payment happened to be dated in.
async function getMemberMasjidPaymentTotalSinceDuesStart(member) {
  const startDate = `${member.dues_start_year}-${String(member.dues_start_month + 1).padStart(2, '0')}-01`;
  const paidRow = await dbGet(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE member_id = $1 AND category = 'Masjid payment' AND type = 'income'
     AND date::date >= $2::date`,
    [member.id, startDate]
  );
  return Number(paidRow.total);
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Full calendar-year (Jan-Dec) month-by-month breakdown for a monthly-plan
// member. `coveredMonths` is however many consecutive months (starting at
// `sequenceOffset` months before this year's January) are paid for -
// `sequenceOffset` is what lets coverage span year boundaries: 0 means
// "count from this year's January" (the no-override default, resets every
// year - see resolveMonthlyCoverage), while a non-zero value threads a
// continuous month sequence from a dues_start override through however many
// calendar years it takes to exhaust. Every month gets one of four statuses:
//   - 'paid': its position in the sequence falls within the covered count
//   - 'partial': the first not-fully-covered month, when there's leftover
//     money short of a full month - e.g. paying 4730 against a 4500 monthly
//     amount covers one month fully with 230 left over, so the next month
//     shows as partially paid instead of flatly 'missed'
//   - 'missed': not covered (and no partial credit), and its month has
//     already started (<= today)
//   - 'nil': not covered, and it's still in the future - paying ahead is the
//            member's choice, so an unpaid future month isn't "missed" yet
// `startMonthIndex` (from resolveDuesStartMonthIndexForYear) forces every
// month before it to 'nil' too - the member simply wasn't obligated yet.
function buildMonthlyBreakdown(member, coveredMonths, remainder, year, cutoffMonthIndex, startMonthIndex = 0, sequenceOffset = 0) {
  if (member.payment_frequency !== 'monthly') return null;

  const monthlyAmount = Number(member.payment_amount);
  const entries = [];
  for (let m = 0; m <= 11; m++) {
    let status;
    let paidAmount;
    if (m < startMonthIndex) {
      status = 'nil';
    } else {
      const relativeIndex = sequenceOffset + m;
      if (relativeIndex >= 0 && relativeIndex < coveredMonths) {
        status = 'paid';
      } else if (relativeIndex === coveredMonths && remainder > 0) {
        status = 'partial';
        paidAmount = remainder;
      } else {
        status = m <= cutoffMonthIndex ? 'missed' : 'nil';
      }
    }
    entries.push({
      year,
      monthIndex: m,
      label: MONTH_LABELS[m],
      status,
      ...(status === 'partial' ? { paidAmount, dueAmount: monthlyAmount } : {}),
    });
  }
  return entries;
}

// Resolves how many months a monthly payer has covered and where that
// coverage sequence starts, for a given calendar year:
//
// - No dues_start override: each calendar year is its own ledger - `paid`
//   is only that year's dated "Masjid payment" transactions, coveredMonths
//   resets to 0 every January (matches the original "pay at start of
//   period, no cross-year carryover" design).
// - Override set: one continuous ledger starting at dues_start_year/month -
//   `paid` is summed across every year from dues_start onward, and coverage
//   fills sequentially month-by-month from dues_start regardless of which
//   calendar year the payment was actually recorded in (e.g. two payments
//   recorded in 2026 still fill Oct/Nov/Dec 2025 first if dues started
//   then), with any excess naturally spilling into future years too - no
//   separate carried-forward-credit step needed.
async function resolveMonthlyCoverage(member, year, today) {
  const startMonthIndex = resolveDuesStartMonthIndexForYear(member, year);
  const monthlyAmount = Number(member.payment_amount);
  const hasOverride = member.dues_start_year != null && member.dues_start_month != null;

  if (hasOverride) {
    const paid = await getMemberMasjidPaymentTotalSinceDuesStart(member);
    const coveredMonths = monthlyAmount > 0 ? Math.floor(paid / monthlyAmount) : 0;
    const remainder = monthlyAmount > 0 ? paid - coveredMonths * monthlyAmount : 0;
    const sequenceOffset = (year - member.dues_start_year) * 12 - member.dues_start_month;
    return { startMonthIndex, coveredMonths, remainder, sequenceOffset };
  }

  // No override: each year is its own ledger, EXCEPT that paying enough
  // this year to cover it entirely with money left over carries that excess
  // one year forward (computeNoOverrideCarriedCredit) - so an overpaying
  // member sees next year's first few months already 'paid' instead of
  // waiting for a transaction dated in that future year.
  let paid;
  if (year === today.year) {
    paid = await getMemberMasjidPaymentTotal(member, today);
  } else if (year === today.year + 1) {
    const carriedCredit = await computeNoOverrideCarriedCredit(member, today);
    paid = (await getMemberMasjidPaymentTotalForYear(member, year)) + carriedCredit;
  } else {
    paid = await getMemberMasjidPaymentTotalForYear(member, year);
  }
  const coveredMonths = monthlyAmount > 0 ? Math.floor(paid / monthlyAmount) : 0;
  const remainder = monthlyAmount > 0 ? paid - coveredMonths * monthlyAmount : 0;
  return { startMonthIndex, coveredMonths, remainder, sequenceOffset: 0 };
}

// How much of a no-override monthly payer's current-year payments are pure
// advance - paid beyond fully covering all 12 months of this year - as a
// rupee amount to carry into next year's `paid` (resolveMonthlyCoverage
// above). Uses the raw rupee excess (not whole-month multiples) so a partial
// 13th month (e.g. 230 of a 4500 monthly amount) still carries forward and
// shows up as next year's 'partial' first month instead of being dropped.
// Members with a dues_start override don't need this: their coverage is
// already one continuous cross-year sequence.
async function computeNoOverrideCarriedCredit(member, today) {
  const monthlyAmount = Number(member.payment_amount);
  if (!(monthlyAmount > 0)) return 0;
  const currentYearPaid = await getMemberMasjidPaymentTotal(member, today);
  return Math.max(currentYearPaid - 12 * monthlyAmount, 0);
}

// Yearly-plan equivalent of the monthly per-year breakdown below - one
// "period" is a full year instead of a month. Lifetime paid is distributed
// sequentially across periods starting at dues_start (or created_at): fully
// covered periods count as fully paid, the next one absorbs whatever's left
// over, and everything after that is unpaid - same sequential-coverage model
// resolveMonthlyCoverage uses for monthly plans, just at year granularity.
// This keeps per-year figures reconcilable with computeLifetimeDues/
// calculateDues's cumulative total (both derive from the same lifetime paid
// sum and the same start point).
async function computeYearlyDuesForYear(member, year, today) {
  const start =
    member.dues_start_year != null && member.dues_start_month != null
      ? { year: member.dues_start_year, monthIndex: member.dues_start_month }
      : getMasjidYearMonth(new Date(member.created_at));
  const periodIndex = year - start.year;
  if (periodIndex < 0) {
    return { hasPlan: true, expected: 0, paid: 0, due: 0, periodsOwed: 0 };
  }

  const yearlyAmount = Number(member.payment_amount);
  const totalPaid = await getMemberMasjidPaymentTotal(member, today);
  const coveredPeriods = yearlyAmount > 0 ? Math.floor(totalPaid / yearlyAmount) : 0;
  const paidForYear =
    periodIndex < coveredPeriods
      ? yearlyAmount
      : periodIndex === coveredPeriods
        ? Math.max(totalPaid - coveredPeriods * yearlyAmount, 0)
        : 0;
  const expected = year <= today.year ? yearlyAmount : 0;
  const periodsOwed = year <= today.year ? 1 : 0;
  return { hasPlan: true, expected, paid: paidForYear, due: expected - paidForYear, periodsOwed };
}

// Monthly breakdown + dues standing for an arbitrary calendar year (not just
// the current one) - used by the profile's year-selector so a member/admin
// can page backward/forward through years' paid/missed months, with
// "Expected So Far" / "Total Paid" / "Credit Balance" tracking whichever year
// is selected instead of staying pinned to the current year. A future year
// just comes back with nothing formally owed (expected/periodsOwed 0) but
// still shows 'paid' months if coverage (see resolveMonthlyCoverage) reaches
// that far ahead - `paid` here is derived from the breakdown itself (count
// of that year's 'paid' months), not the raw sum of that year's dated
// transactions, since under a dues_start override a payment recorded in one
// calendar year can cover months in a different one.
async function computeMonthlyBreakdownForYear(member, year, today) {
  if (member.payment_frequency === 'yearly') {
    if (member.payment_amount == null) {
      return { breakdown: null, dues: { hasPlan: false, expected: null, paid: 0, due: null, periodsOwed: null } };
    }
    const dues = await computeYearlyDuesForYear(member, year, today);
    return { breakdown: null, dues };
  }
  if (member.payment_frequency !== 'monthly') {
    return { breakdown: null, dues: { hasPlan: false, expected: null, paid: 0, due: null, periodsOwed: null } };
  }
  const { startMonthIndex, coveredMonths, remainder, sequenceOffset } = await resolveMonthlyCoverage(member, year, today);
  const cutoffMonthIndex = year < today.year ? 11 : year === today.year ? today.monthIndex : -1;
  const breakdown = buildMonthlyBreakdown(member, coveredMonths, remainder, year, cutoffMonthIndex, startMonthIndex, sequenceOffset);

  const monthlyAmount = Number(member.payment_amount);
  const paidForYear = breakdown.reduce(
    (sum, entry) => sum + (entry.status === 'paid' ? monthlyAmount : entry.status === 'partial' ? entry.paidAmount : 0),
    0
  );

  const periodsOwed =
    startMonthIndex >= 12
      ? 0
      : year < today.year
        ? 12 - startMonthIndex
        : year === today.year
          ? Math.max(today.monthIndex - startMonthIndex + 1, 0)
          : 0;
  const expected = monthlyAmount * periodsOwed;
  const dues = { hasPlan: true, expected, paid: paidForYear, due: expected - paidForYear, periodsOwed };

  return { breakdown, dues };
}

// Shared dues+breakdown computation for "today" specifically - used by both
// the profile payload and the dues-reminder job. Monthly plans go through
// computeMonthlyBreakdownForYear (which also resolves the dues_start
// override); yearly plans have no month breakdown and use calculateDues
// directly against their lifetime-cumulative paid total.
async function computeCurrentDuesAndBreakdown(member, today) {
  if (member.payment_frequency === 'monthly') {
    const { breakdown, dues } = await computeMonthlyBreakdownForYear(member, today.year, today);
    return { dues, monthlyBreakdown: breakdown };
  }
  const paid = await getMemberMasjidPaymentTotal(member, today);
  return { dues: calculateDues(member, paid, today), monthlyBreakdown: null };
}

// How many years past `today.year` a monthly payer's coverage (see
// resolveMonthlyCoverage) actually reaches - used as the profile
// year-selector's upper bound so an overpaying member can navigate forward
// to see those months already marked 'paid'. 0 if coverage doesn't reach
// past the current year.
//
// With a dues_start override, coverage is one continuous sequence that can
// run arbitrarily far ahead, so the last covered year is computed directly
// from dues_start_month + coveredMonths (months-since-dues_start's January).
// Without an override, resolveMonthlyCoverage only ever carries at most one
// year of credit forward (computeNoOverrideCarriedCredit), so the check is
// just "did that carry produce anything".
async function computeMonthlyMaxYearOffset(member, today) {
  if (member.payment_frequency !== 'monthly') return 0;
  const hasOverride = member.dues_start_year != null && member.dues_start_month != null;

  if (hasOverride) {
    const { coveredMonths } = await resolveMonthlyCoverage(member, today.year, today);
    if (coveredMonths <= 0) return 0;
    const lastCoveredYear =
      member.dues_start_year + Math.floor((member.dues_start_month + coveredMonths - 1) / 12);
    return Math.max(lastCoveredYear - today.year, 0);
  }

  const carriedCredit = await computeNoOverrideCarriedCredit(member, today);
  return carriedCredit > 0 ? 1 : 0;
}

// Lifetime dues standing across every year the member has been on the
// books, not just the current one - used for the profile's "Payment
// Standing" card so a monthly payer's unpaid prior years (which
// computeCurrentDuesAndBreakdown deliberately resets every January, see
// resolveMonthlyCoverage) still show up in their overall pending balance.
// Yearly plans are already lifetime-cumulative via calculateDues, so this
// just delegates to that; monthly plans sum each year's own expected/paid/due
// from joinYear through the current year (future years are excluded so an
// overpaying member's carried-forward credit isn't double-counted).
async function computeLifetimeDues(member, joinYear, today) {
  if (member.payment_amount == null || !member.payment_frequency) {
    return { hasPlan: false, expected: null, paid: 0, due: null, periodsOwed: null };
  }
  if (member.payment_frequency !== 'monthly') {
    const paid = await getMemberMasjidPaymentTotal(member, today);
    return calculateDues(member, paid, today);
  }

  let expected = 0;
  let paid = 0;
  let periodsOwed = 0;
  for (let year = joinYear; year <= today.year; year++) {
    const { dues } = await computeMonthlyBreakdownForYear(member, year, today);
    expected += dues.expected ?? 0;
    paid += dues.paid ?? 0;
    periodsOwed += dues.periodsOwed ?? 0;
  }
  return { hasPlan: true, expected, paid, due: expected - paid, periodsOwed };
}

// Shared payload builder for both a member viewing their own profile and an
// admin viewing a member's profile via the admin-only lookup route.
async function buildMemberProfilePayload(member) {
  const transactions = await dbAll(
    'SELECT * FROM transactions WHERE member_id = $1 ORDER BY date DESC',
    [member.id]
  );
  const today = getMasjidTodayParts();
  const { dues, monthlyBreakdown } = await computeCurrentDuesAndBreakdown(member, today);

  // The year-selector's lower bound: normally the member's created_at year,
  // but extended back further to whichever is earliest of: an earlier-dated
  // transaction on record (e.g. backfilled history from before their member
  // record was created), or an admin-set dues_start_year that predates both
  // (e.g. dues start Oct 2025 for a member added to the system in 2026) -
  // otherwise that year would be unreachable via the selector even though
  // it's exactly the year the dues-start override is meant to expose.
  const createdYear = getMasjidYearMonth(new Date(member.created_at)).year;
  const earliestTransactionYear = transactions.length
    ? Math.min(...transactions.map((t) => getMasjidYearMonth(new Date(t.date)).year))
    : createdYear;
  const joinYear = Math.min(createdYear, earliestTransactionYear, member.dues_start_year ?? createdYear);

  // The upper bound: normally currentYear, but extended forward as far as
  // the member's payment coverage actually reaches (computeMonthlyMaxYearOffset).
  const maxYear = today.year + (await computeMonthlyMaxYearOffset(member, today));

  const lifetimeDues = await computeLifetimeDues(member, joinYear, today);

  return { member, dues, lifetimeDues, monthlyBreakdown, transactions, currentYear: today.year, joinYear, maxYear };
}

async function ensureRotationState() {
  let state = await dbGet('SELECT * FROM rotation_state WHERE id = 1');
  if (!state) {
    const activeMembers = await getActiveMembersOrdered();
    const today = todayInMasjidTimezone();
    await dbRun(
      'INSERT INTO rotation_state (id, cycle_start_date, cycle_member_ids, cycle_number) VALUES (1, $1, $2, 1)',
      [today, JSON.stringify(activeMembers.map((m) => m.id))]
    );
    state = await dbGet('SELECT * FROM rotation_state WHERE id = 1');
  }
  return state;
}

// Advances the rotation cycle forward (re-snapshotting active members) if the
// current cycle has fully elapsed. This is where member additions/removals
// take effect - only at a cycle boundary, never mid-cycle. Crucially, when
// re-snapshotting it preserves the EXISTING rotation order for members who
// are still active (dropping only those no longer active) and appends any
// newly-active members at the end - it never resets to plain position order,
// so a custom anchor/order (from an anchor rebase or "set as current") keeps
// rotating correctly indefinitely as long as membership doesn't change.
async function advanceRotationIfNeeded(state) {
  let cycleMemberIds = JSON.parse(state.cycle_member_ids);
  let cycleStartDate = state.cycle_start_date;
  let cycleNumber = state.cycle_number;
  const todayStr = todayInMasjidTimezone();
  let changed = false;

  if (cycleMemberIds.length > 0 && daysBetweenDates(cycleStartDate, todayStr) >= cycleMemberIds.length) {
    const activeIds = (await getActiveMembersOrdered()).map((m) => m.id);

    while (cycleMemberIds.length > 0 && daysBetweenDates(cycleStartDate, todayStr) >= cycleMemberIds.length) {
      const startDateObj = new Date(cycleStartDate + 'T00:00:00Z');
      startDateObj.setUTCDate(startDateObj.getUTCDate() + cycleMemberIds.length);
      cycleStartDate = formatDateOnly(startDateObj);
      cycleNumber += 1;

      const survivors = cycleMemberIds.filter((id) => activeIds.includes(id));
      const newcomers = activeIds.filter((id) => !cycleMemberIds.includes(id));
      cycleMemberIds = [...survivors, ...newcomers];
      changed = true;
    }
  }

  // If the rotation started with zero active members and some have since been added.
  if (cycleMemberIds.length === 0) {
    const activeMembers = await getActiveMembersOrdered();
    if (activeMembers.length > 0) {
      cycleMemberIds = activeMembers.map((m) => m.id);
      cycleStartDate = todayStr;
      cycleNumber += 1;
      changed = true;
    }
  }

  if (changed) {
    await dbRun(
      'UPDATE rotation_state SET cycle_start_date = $1, cycle_member_ids = $2, cycle_number = $3 WHERE id = 1',
      [cycleStartDate, JSON.stringify(cycleMemberIds), cycleNumber]
    );
  }

  return { cycle_start_date: cycleStartDate, cycle_member_ids: JSON.stringify(cycleMemberIds), cycle_number: cycleNumber };
}

function computeMemberIdForDate(cycleStartDate, cycleMemberIds, targetDateStr) {
  const cycleLength = cycleMemberIds.length;
  if (cycleLength === 0) return null;
  const diffDays = daysBetweenDates(cycleStartDate, targetDateStr);
  const idx = ((diffDays % cycleLength) + cycleLength) % cycleLength;
  return cycleMemberIds[idx];
}

// Builds the rotation context needed to resolve a boundary-aware computed
// member id for any date - shared by getYearlySchedule() and the swap
// handlers so a pending membership change (added/removed active member,
// current cycle not yet naturally rolled over) is projected consistently
// everywhere, not just in the yearly view.
async function getRotationProjectionContext() {
  const rawState = await ensureRotationState();
  const state = await advanceRotationIfNeeded(rawState);
  const currentCycleMemberIds = JSON.parse(state.cycle_member_ids);
  const currentCycleStart = state.cycle_start_date;

  const activeMembers = await getActiveMembersOrdered();
  const fullActiveIds = activeMembers.map((m) => m.id);

  // If a member has been added/removed but the in-progress cycle hasn't hit
  // its natural boundary yet, project the same continuity-preserving merge
  // that advanceRotationIfNeeded() will apply once that boundary is reached.
  const membershipMatches =
    currentCycleMemberIds.length === fullActiveIds.length &&
    fullActiveIds.every((id) => currentCycleMemberIds.includes(id));

  let boundaryDateStr = null;
  let projectedCycleMemberIds = null;
  if (!membershipMatches) {
    const boundaryDateObj = new Date(currentCycleStart + 'T00:00:00Z');
    boundaryDateObj.setUTCDate(boundaryDateObj.getUTCDate() + currentCycleMemberIds.length);
    boundaryDateStr = formatDateOnly(boundaryDateObj);

    const survivors = currentCycleMemberIds.filter((id) => fullActiveIds.includes(id));
    const newcomers = fullActiveIds.filter((id) => !currentCycleMemberIds.includes(id));
    projectedCycleMemberIds = [...survivors, ...newcomers];
  }

  return {
    state,
    currentCycleMemberIds,
    currentCycleStart,
    activeMembers,
    boundaryDateStr,
    projectedCycleMemberIds,
  };
}

function resolveComputedMemberId(ctx, dateStr) {
  return ctx.boundaryDateStr && dateStr >= ctx.boundaryDateStr
    ? computeMemberIdForDate(ctx.boundaryDateStr, ctx.projectedCycleMemberIds, dateStr)
    : computeMemberIdForDate(ctx.currentCycleStart, ctx.currentCycleMemberIds, dateStr);
}

// Returns whoever is currently assigned to a date - the override's member if
// one exists, otherwise the boundary-aware computed rotation member.
async function getCurrentAssignedMemberId(ctx, dateStr) {
  const computedId = resolveComputedMemberId(ctx, dateStr);
  const override = await dbGet('SELECT * FROM schedule_overrides WHERE date = $1', [dateStr]);
  return override ? override.member_id : computedId;
}

// "Tomorrow" in the masjid's timezone - must add a day to the Kolkata-local
// date string, not do naive UTC/server-local Date math (which would disagree
// with todayInMasjidTimezone() near midnight depending on server location).
function tomorrowInMasjidTimezone() {
  const todayObj = new Date(todayInMasjidTimezone() + 'T00:00:00Z');
  todayObj.setUTCDate(todayObj.getUTCDate() + 1);
  return formatDateOnly(todayObj);
}

// Persists one member's personal notification (payment received, dues
// reminder, food-day reminder) so it can be read inside the app - kept in
// its own table from `announcements`, so it's only ever visible to the
// member it belongs to, never to other members or in the shared broadcast list.
async function recordMemberNotification(memberId, title, message) {
  if (!memberId) return;
  await dbRun(
    'INSERT INTO member_notifications (id, member_id, title, message) VALUES ($1, $2, $3, $4)',
    [uuidv4(), memberId, title, message]
  );
}

// Sends a push reminder to every device subscribed by tomorrow's food-day
// assignee. Triggered once daily by an external scheduler (see
// /api/push/run-daily-check) rather than an in-process timer, since this
// backend can sleep on its host's free tier. Not idempotent - a mid-loop
// crash could double-send to a later subscription on retry - acceptable for
// a once-daily reminder, but worth knowing before adding automatic retries.
async function sendTomorrowAssignmentReminders() {
  if (!pushEnabled) return { sent: 0, failed: 0, reason: 'push not configured' };

  const tomorrowStr = tomorrowInMasjidTimezone();
  const ctx = await getRotationProjectionContext();
  const memberId = await getCurrentAssignedMemberId(ctx, tomorrowStr);
  if (!memberId) return { sent: 0, failed: 0, reason: 'no assignee resolved for tomorrow' };

  const member = await dbGet('SELECT * FROM members WHERE id = $1', [memberId]);
  const subscriptions = await dbAll('SELECT * FROM push_subscriptions WHERE member_id = $1', [memberId]);

  const title = 'മസ്ജിദ് ഭക്ഷണ ഓർമ്മപ്പെടുത്തൽ';
  const body = `നാളെ (${tomorrowStr}) ഭക്ഷണ ചുമതല നിങ്ങളുടേതാണ്.`;
  await recordMemberNotification(memberId, title, body);
  const payload = JSON.stringify({ title, body, url: '/?view=my-notifications' });

  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await dbRun('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      }
    }
  }

  return { sent, failed, date: tomorrowStr, memberId, memberName: member?.name };
}

// Notifies a member's subscribed devices that a "Masjid payment" transaction
// was just recorded against them (covers both monthly and yearly payers -
// the category is the same either way, only the member's own payment_frequency
// differs, which isn't relevant to the notification text itself).
async function sendPaymentReceivedNotification(memberId, amount) {
  if (!memberId) return;
  const title = 'Payment Received - Masjid Rahma';
  const body = `We've received your payment of ₹${Number(amount).toFixed(2)} as Masjid payment. Jazakallah Khair!`;
  try {
    await recordMemberNotification(memberId, title, body);
  } catch (err) {
    console.warn(`Failed to record payment-received notification: ${err.message}`);
  }

  if (!pushEnabled) return;
  try {
    const subscriptions = await dbAll('SELECT * FROM push_subscriptions WHERE member_id = $1', [memberId]);
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, url: '/?view=my-notifications' });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await dbRun('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to send payment-received notification: ${err.message}`);
  }
}

// Notifies a member's subscribed devices whenever an admin adds, edits, or
// deletes a transaction attributed to them (member_id set) - covers every
// category, not just "Masjid payment" (that create case gets the friendlier
// wording above via sendPaymentReceivedNotification instead, to avoid
// double-notifying).
async function notifyMemberOfTransaction(memberId, action, transaction) {
  if (!memberId) return;
  const amountStr = `₹${Number(transaction.amount).toFixed(2)}`;
  const verb = transaction.type === 'income' ? 'credited' : 'debited';
  let title;
  let body;
  if (action === 'updated') {
    title = 'Transaction Updated - Masjid Rahma';
    body = `A ${transaction.category} transaction of ${amountStr} (${verb}) on your account was updated.`;
  } else if (action === 'deleted') {
    title = 'Transaction Removed - Masjid Rahma';
    body = `A ${transaction.category} transaction of ${amountStr} (${verb}) on your account was removed.`;
  } else {
    title = 'Transaction Recorded - Masjid Rahma';
    body = `A ${transaction.category} transaction of ${amountStr} (${verb}) was recorded on your account.`;
  }

  try {
    await recordMemberNotification(memberId, title, body);
  } catch (err) {
    console.warn(`Failed to record transaction notification: ${err.message}`);
  }

  if (!pushEnabled) return;
  try {
    const subscriptions = await dbAll('SELECT * FROM push_subscriptions WHERE member_id = $1', [memberId]);
    if (subscriptions.length === 0) return;
    const payload = JSON.stringify({ title, body, url: '/?view=my-notifications' });
    await sendPushToSubscriptions(subscriptions, payload);
  } catch (err) {
    console.warn(`Failed to send transaction notification: ${err.message}`);
  }
}

// True on the last calendar day of the current month in the masjid's
// timezone (i.e. tomorrow rolls into a new month). No native "run on the
// last day of the month" cron syntax exists, so the external scheduler
// calls this check daily and it only actually sends on that one day.
function isLastDayOfMasjidMonth() {
  const todayStr = todayInMasjidTimezone();
  const tomorrowStr = tomorrowInMasjidTimezone();
  return todayStr.slice(0, 7) !== tomorrowStr.slice(0, 7);
}

// Shared low-level sender used by every reminder/announcement feature - sends
// the same payload to each device subscription passed in, cleaning up any
// that report expired (404/410) along the way.
async function sendPushToSubscriptions(subscriptions, payload) {
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await dbRun('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      }
    }
  }
  return { sent, failed };
}

// Computes a member's outstanding due plus (for monthly payers) which
// specific months are unpaid - shared by the month-end reminder job, the
// admin's pending-payments list, and the admin's on-demand reminder button.
async function computeMemberDueInfo(member, today) {
  const { dues, monthlyBreakdown } = await computeCurrentDuesAndBreakdown(member, today);
  if (!dues.hasPlan || !dues.due || dues.due <= 0) {
    return { ...dues, missedMonths: null };
  }
  const missedMonths = monthlyBreakdown
    ? monthlyBreakdown.filter((entry) => entry.status === 'missed').map((entry) => entry.label)
    : null;
  return { ...dues, missedMonths };
}

// Returns the { title, body } for a member's dues reminder, or null if
// they're not actually eligible (no due, or monthly but nothing marked
// missed yet - e.g. the current in-progress month only, per calculateDues).
// Kept as plain data (not a push payload) since getPendingDuesMembers() also
// calls this just to check eligibility, for every member, on every admin
// page load - it must stay a pure read, with no side effects like persisting
// a notification.
function buildDuesReminderPayload(member, dueInfo) {
  if (!dueInfo.hasPlan || !dueInfo.due || dueInfo.due <= 0) return null;
  let body;
  if (member.payment_frequency === 'monthly') {
    if (!dueInfo.missedMonths || dueInfo.missedMonths.length === 0) return null;
    body = `You have unpaid Masjid payment dues for: ${dueInfo.missedMonths.join(', ')} (₹${dueInfo.due.toFixed(2)}). Please settle at your earliest convenience.`;
  } else {
    body = `Your yearly Masjid payment of ₹${dueInfo.due.toFixed(2)} is due. Please settle at your earliest convenience.`;
  }
  return { title: 'Masjid Payment Reminder', body };
}

// Reminds members with an outstanding "Masjid payment" due at month end -
// monthly-plan members get their specific missed months listed, yearly-plan
// members get the outstanding amount for the year. Only active members with
// a payment plan configured are considered; members with no plan (hasPlan
// false) are silently skipped, matching how dues are treated everywhere else
// in the app. `force` bypasses the last-day-of-month gate for manual testing.
async function sendMonthEndDuesReminders({ force = false } = {}) {
  if (!pushEnabled) return { checked: 0, remindersSent: 0, failed: 0, reason: 'push not configured' };
  if (!force && !isLastDayOfMasjidMonth()) {
    return { checked: 0, remindersSent: 0, failed: 0, reason: 'not the last day of the month' };
  }

  const today = getMasjidTodayParts();
  const members = await dbAll(
    `SELECT * FROM members WHERE active = true AND payment_amount IS NOT NULL AND payment_frequency IS NOT NULL`
  );

  let checked = 0;
  let remindersSent = 0;
  let failed = 0;

  for (const member of members) {
    checked += 1;
    const dueInfo = await computeMemberDueInfo(member, today);
    const reminder = buildDuesReminderPayload(member, dueInfo);
    if (!reminder) continue;

    await recordMemberNotification(member.id, reminder.title, reminder.body);

    const subscriptions = await dbAll('SELECT * FROM push_subscriptions WHERE member_id = $1', [member.id]);
    if (subscriptions.length === 0) continue;

    const payload = JSON.stringify({ ...reminder, url: '/?view=my-notifications' });
    const result = await sendPushToSubscriptions(subscriptions, payload);
    failed += result.failed;
    if (result.sent > 0) remindersSent += 1;
  }

  return { checked, remindersSent, failed, month: today.monthIndex + 1, year: today.year };
}

// Active members with an outstanding Masjid payment due, for the admin
// "Pending Payments" list - live/on-demand, independent of the month-end
// gate that guards the automated reminder job.
async function getPendingDuesMembers() {
  const today = getMasjidTodayParts();
  const members = await dbAll(
    `SELECT * FROM members WHERE active = true AND payment_amount IS NOT NULL AND payment_frequency IS NOT NULL ORDER BY position ASC`
  );

  const pending = [];
  for (const member of members) {
    const dueInfo = await computeMemberDueInfo(member, today);
    if (!buildDuesReminderPayload(member, dueInfo)) continue;
    const subRow = await dbGet('SELECT COUNT(*)::int as count FROM push_subscriptions WHERE member_id = $1', [member.id]);
    pending.push({
      id: member.id,
      unique_id: member.unique_id,
      name: member.name,
      phone: member.phone,
      payment_frequency: member.payment_frequency,
      due: dueInfo.due,
      missedMonths: dueInfo.missedMonths,
      hasPushSubscription: subRow.count > 0,
    });
  }
  return pending;
}

// Sends the standard dues reminder to one member on demand (an admin
// action, not gated by last-day-of-month like the automated job).
async function remindMemberOfDues(memberId) {
  const member = await dbGet('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!member) return { sent: 0, failed: 0, reason: 'member not found' };

  const today = getMasjidTodayParts();
  const dueInfo = await computeMemberDueInfo(member, today);
  const reminder = buildDuesReminderPayload(member, dueInfo);
  if (!reminder) return { sent: 0, failed: 0, reason: 'no outstanding due' };

  await recordMemberNotification(memberId, reminder.title, reminder.body);

  if (!pushEnabled) return { sent: 0, failed: 0, reason: 'push not configured' };
  const subscriptions = await dbAll('SELECT * FROM push_subscriptions WHERE member_id = $1', [memberId]);
  if (subscriptions.length === 0) return { sent: 0, failed: 0, reason: 'member has no subscribed devices' };

  const payload = JSON.stringify({ ...reminder, url: '/?view=my-notifications' });
  return sendPushToSubscriptions(subscriptions, payload);
}

// Broadcasts a general announcement to every subscribed device across all
// members - unlike the other reminders, this isn't dues/schedule-specific.
// Always persisted to the announcements table (even if push isn't
// configured or nobody is subscribed) so it shows up in the in-app list -
// tapping the push notification lands on that list via url: '/?view=announcements'.
async function sendAnnouncement(title, message) {
  await dbRun('INSERT INTO announcements (id, title, message) VALUES ($1, $2, $3)', [uuidv4(), title, message]);
  if (!pushEnabled) return { sent: 0, failed: 0, reason: 'push not configured' };
  const subscriptions = await dbAll('SELECT * FROM push_subscriptions');
  if (subscriptions.length === 0) return { sent: 0, failed: 0, reason: 'no subscribed devices' };
  const payload = JSON.stringify({ title, body: message, url: '/?view=announcements' });
  return sendPushToSubscriptions(subscriptions, payload);
}

// Creates, replaces, or (if memberId matches the boundary-aware computed
// rotation member) clears the override for a date - the single source of
// truth for "assign this date to this member" used by both the one-time
// swap endpoint and the mutual-swap endpoint.
async function applySwapOverride(ctx, dateStr, memberId, reason) {
  const computedId = resolveComputedMemberId(ctx, dateStr);
  if (memberId === computedId) {
    await dbRun('DELETE FROM schedule_overrides WHERE date = $1', [dateStr]);
    return { date: dateStr, member_id: null, reverted: true };
  }

  await dbRun(
    `INSERT INTO schedule_overrides (date, member_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (date) DO UPDATE SET member_id = EXCLUDED.member_id, reason = EXCLUDED.reason`,
    [dateStr, memberId, reason || null]
  );
  return dbGet('SELECT * FROM schedule_overrides WHERE date = $1', [dateStr]);
}

// Returns today's food-supply assignment, applying any one-time swap override.
async function getTodaysAssignment() {
  const rawState = await ensureRotationState();
  const state = await advanceRotationIfNeeded(rawState);
  const cycleMemberIds = JSON.parse(state.cycle_member_ids);
  const todayStr = todayInMasjidTimezone();

  if (cycleMemberIds.length === 0) {
    return { date: todayStr, member: null, swapped: false };
  }

  const computedId = computeMemberIdForDate(state.cycle_start_date, cycleMemberIds, todayStr);
  const computedMember = await dbGet('SELECT * FROM members WHERE id = $1', [computedId]);
  const override = await dbGet('SELECT * FROM schedule_overrides WHERE date = $1', [todayStr]);

  if (override && override.member_id !== computedId) {
    const overrideMember = await dbGet('SELECT * FROM members WHERE id = $1', [override.member_id]);
    return { date: todayStr, member: overrideMember, swapped: true, originalMember: computedMember };
  }

  return { date: todayStr, member: computedMember, swapped: false };
}

// Returns a preview of the next `days` days (including today), applying overrides.
async function getSchedulePreview(days) {
  const rawState = await ensureRotationState();
  const state = await advanceRotationIfNeeded(rawState);
  const cycleMemberIds = JSON.parse(state.cycle_member_ids);
  const todayStr = todayInMasjidTimezone();

  const overrides = await dbAll('SELECT * FROM schedule_overrides');
  const overrideByDate = new Map(overrides.map((o) => [o.date, o.member_id]));
  const membersById = new Map((await dbAll('SELECT * FROM members')).map((m) => [m.id, m]));

  const results = [];
  for (let i = 0; i < days; i++) {
    const targetDateObj = new Date(todayStr + 'T00:00:00Z');
    targetDateObj.setUTCDate(targetDateObj.getUTCDate() + i);
    const targetDateStr = formatDateOnly(targetDateObj);

    const computedId = computeMemberIdForDate(state.cycle_start_date, cycleMemberIds, targetDateStr);
    const overrideMemberId = overrideByDate.get(targetDateStr);
    const swapped = Boolean(overrideMemberId) && overrideMemberId !== computedId;
    const member = swapped ? membersById.get(overrideMemberId) : (computedId ? membersById.get(computedId) : null);
    const originalMember = swapped && computedId ? membersById.get(computedId) : undefined;

    results.push({ date: targetDateStr, member: member || null, swapped, originalMember });
  }

  return results;
}

// Returns, for every active member, which day-of-month they're on duty in
// each month of the given year - a read-only projection. Dates before the
// current cycle's natural boundary use the current (possibly stale/narrower)
// snapshot; dates from that boundary onward assume the full current active
// member list applies, mirroring exactly what advanceRotationIfNeeded() will
// do in real time when that boundary is actually reached. It does not
// reconstruct genuine past history if the active member list changed earlier.
async function getYearlySchedule(year) {
  const ctx = await getRotationProjectionContext();
  const { activeMembers } = ctx;

  const overrides = await dbAll(
    'SELECT * FROM schedule_overrides WHERE date >= $1 AND date <= $2',
    [`${year}-01-01`, `${year}-12-31`]
  );
  const overrideByDate = new Map(overrides.map((o) => [o.date, o.member_id]));
  const memberNameById = new Map(activeMembers.map((m) => [m.id, m.name]));

  const monthsByMemberId = new Map(
    activeMembers.map((m) => [m.id, Array.from({ length: 12 }, () => [])])
  );

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeapYear ? 366 : 365;

  for (let d = 0; d < daysInYear; d++) {
    const dateObj = new Date(Date.UTC(year, 0, 1));
    dateObj.setUTCDate(dateObj.getUTCDate() + d);
    const dateStr = formatDateOnly(dateObj);
    const day = dateObj.getUTCDate();
    const month = dateObj.getUTCMonth();

    const computedId = resolveComputedMemberId(ctx, dateStr);

    const overrideMemberId = overrideByDate.get(dateStr);
    const isSwap = Boolean(overrideMemberId) && overrideMemberId !== computedId;
    const assignedId = isSwap ? overrideMemberId : computedId;

    const assignedMonths = assignedId && monthsByMemberId.get(assignedId);
    if (assignedMonths) {
      assignedMonths[month].push({
        day,
        swapped: isSwap ? 'in' : undefined,
        otherMemberName: isSwap ? memberNameById.get(computedId) : undefined,
      });
    }

    if (isSwap) {
      const originalMonths = monthsByMemberId.get(computedId);
      if (originalMonths) {
        originalMonths[month].push({
          day,
          swapped: 'away',
          otherMemberName: memberNameById.get(assignedId),
        });
      }
    }
  }

  return {
    year,
    members: activeMembers.map((m) => ({
      id: m.id,
      unique_id: m.unique_id,
      name: m.name,
      months: monthsByMemberId.get(m.id),
    })),
  };
}

// Routes

// Auth: check whether an admin account has been created yet
app.get('/api/auth/status', async (req, res) => {
  try {
    const row = await dbGet('SELECT COUNT(*) as count FROM users WHERE is_admin = true');
    res.json({ hasAdmin: Number(row.count) > 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: one-time admin account creation (only works while no admin exists)
app.post('/api/auth/setup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const existing = await dbGet('SELECT COUNT(*) as count FROM users WHERE is_admin = true');
    if (Number(existing.count) > 0) {
      return res.status(409).json({ error: 'An admin account already exists' });
    }
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    await dbRun(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES ($1, $2, $3, true)',
      [id, username, passwordHash]
    );
    const token = jwt.sign({ id, username, isAdmin: true, memberId: null }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, username, isAdmin: true, memberId: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: unified login for the admin account and member self-service accounts.
// Members log in with their unique_id as username and their current phone
// number as password (validated live against members.phone, not a stored
// hash) - editing phone via the admin form updates their login automatically.
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await dbGet('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.is_admin) {
      if (!user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
    } else {
      const member = await dbGet('SELECT * FROM members WHERE id = $1', [user.member_id]);
      if (!member || !member.active) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      // Members log in against their phone number by default, but once they've
      // set a custom password via change-password, that hash takes over - a
      // member who changes their password shouldn't be locked out just because
      // the admin later edits their phone number on file.
      if (user.password_hash) {
        if (!(await bcrypt.compare(password, user.password_hash))) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
      } else if (!member.phone || member.phone.trim() === '' || password !== member.phone) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.is_admin, memberId: user.member_id || null },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, username: user.username, isAdmin: user.is_admin, memberId: user.member_id || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: sliding-session refresh - called by the frontend on app load while a
// token is present, so a user who opens the app at least once a month never
// hits a hard expiry, while an untouched token still dies after 30 days.
// requireAuth already rejects an expired/invalid token with 401, so this
// only ever re-issues a token that was still good - the frontend's apiFetch
// interceptor treats a 401 here exactly like any other expired session.
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const user = await dbGet('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (user.member_id) {
      const member = await dbGet('SELECT active FROM members WHERE id = $1', [user.member_id]);
      if (!member || !member.active) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.is_admin, memberId: user.member_id || null },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, username: user.username, isAdmin: user.is_admin, memberId: user.member_id || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: change password (any logged-in user - admin or member - must know
// current password). For a member who hasn't set a custom password yet,
// "current password" is their phone number (their default login).
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await dbGet('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    let currentValid = false;
    if (user.password_hash) {
      currentValid = await bcrypt.compare(currentPassword, user.password_hash);
    } else if (!user.is_admin) {
      const member = await dbGet('SELECT * FROM members WHERE id = $1', [user.member_id]);
      currentValid = !!member && member.active && !!member.phone && currentPassword === member.phone;
    }
    if (!currentValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await dbRun('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const { clause, params } = dateRangeClause(req);
    const transactions = await dbAll(`SELECT * FROM transactions ${clause} ORDER BY date DESC`, params);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transactions by type (income/expense)
app.get('/api/transactions/type/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const transactions = await dbAll(
      'SELECT * FROM transactions WHERE type = $1 ORDER BY date DESC',
      [type]
    );
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transaction summary (total income, total expense, balance)
app.get('/api/summary', async (req, res) => {
  try {
    const { clause, params } = dateRangeClause(req);
    const summary = await dbAll(`
      SELECT
        type,
        SUM(amount) as total
      FROM transactions
      ${clause}
      GROUP BY type
    `, params);

    let income = 0, expense = 0;
    summary.forEach(row => {
      if (row.type === 'income') income = Number(row.total) || 0;
      if (row.type === 'expense') expense = Number(row.total) || 0;
    });

    res.json({
      totalIncome: income,
      totalExpense: expense,
      balance: income - expense
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transactions by category
app.get('/api/transactions/category/stats', async (req, res) => {
  try {
    const { clause, params } = dateRangeClause(req);
    const stats = await dbAll(`
      SELECT
        category,
        type,
        COUNT(*) as count,
        SUM(amount) as total
      FROM transactions
      ${clause}
      GROUP BY category, type
      ORDER BY type, total DESC
    `, params);
    res.json(stats.map(row => ({ ...row, count: Number(row.count), total: Number(row.total) })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bank/committee accounts with their live balance (opening_balance plus
// every transaction attributed to them since) - public read, same as
// /api/summary, since financial data here is view-public / edit-admin-only.
app.get('/api/banks', async (req, res) => {
  try {
    const banks = await dbAll(`
      SELECT b.id, b.name, b.opening_balance, b.created_at,
        b.opening_balance
          + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)
          AS balance
      FROM banks b
      LEFT JOIN transactions t ON t.bank_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at ASC
    `);
    res.json(banks.map((b) => ({
      ...b,
      opening_balance: Number(b.opening_balance),
      balance: Number(b.balance),
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new bank/committee account (admin-only "master entry" - most
// masjids will only ever add a couple of these).
app.post('/api/banks', requireAdmin, async (req, res) => {
  try {
    const { name, openingBalance } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const id = uuidv4();
    await dbRun(
      'INSERT INTO banks (id, name, opening_balance) VALUES ($1, $2, $3)',
      [id, name.trim(), openingBalance ?? 0]
    );
    const newBank = await dbGet('SELECT id, name, opening_balance, created_at FROM banks WHERE id = $1', [id]);
    res.status(201).json({ ...newBank, opening_balance: Number(newBank.opening_balance), balance: Number(newBank.opening_balance) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A bank with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update a bank's name/opening balance.
app.put('/api/banks/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, openingBalance } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await dbRun(
      'UPDATE banks SET name = $1, opening_balance = $2 WHERE id = $3',
      [name.trim(), openingBalance ?? 0, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bank not found' });
    }
    const banks = await dbAll(
      `SELECT b.id, b.name, b.opening_balance, b.created_at,
        b.opening_balance
          + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)
          AS balance
       FROM banks b
       LEFT JOIN transactions t ON t.bank_id = b.id
       WHERE b.id = $1
       GROUP BY b.id`,
      [id]
    );
    const updated = banks[0];
    res.json({ ...updated, opening_balance: Number(updated.opening_balance), balance: Number(updated.balance) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A bank with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Create new transaction
app.post('/api/transactions', requireAdmin, async (req, res) => {
  try {
    const { type, category, amount, description, date, memberId, bankId } = req.body;

    if (!type || !category || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (type === 'income' && category === 'Masjid payment' && !memberId) {
      return res.status(400).json({ error: 'A member must be selected for Masjid payment transactions' });
    }

    const id = uuidv4();
    const transactionDate = date || new Date().toISOString();

    await dbRun(
      'INSERT INTO transactions (id, type, category, amount, description, date, member_id, bank_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, type, category, amount, description || '', transactionDate, memberId || null, bankId || null]
    );

    const newTransaction = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.status(201).json(newTransaction);

    if (memberId) {
      if (type === 'income' && category === 'Masjid payment') {
        runInBackground(sendPaymentReceivedNotification(memberId, amount));
      } else {
        runInBackground(notifyMemberOfTransaction(memberId, 'added', newTransaction));
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update transaction
app.put('/api/transactions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, category, amount, description, date, memberId, bankId } = req.body;

    if (!type || !category || !amount || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (type === 'income' && category === 'Masjid payment' && !memberId) {
      return res.status(400).json({ error: 'A member must be selected for Masjid payment transactions' });
    }

    const result = await dbRun(
      `UPDATE transactions SET type = $1, category = $2, amount = $3, description = $4, date = $5, member_id = $6, bank_id = $7
       WHERE id = $8`,
      [type, category, amount, description || '', date, memberId || null, bankId || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updated = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.json(updated);

    if (updated.member_id) {
      runInBackground(notifyMemberOfTransaction(updated.member_id, 'updated', updated));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed the database with realistic sample transactions (for testing/demo purposes)
app.post('/api/transactions/seed', requireAdmin, async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 50, 1), 500);

    const incomeCategories = ['Donation', 'Zakat', 'Masjid Fund', 'Other Income'];
    const expenseCategories = ['Utilities', 'Maintenance', 'Supplies', 'Staff', 'Events', 'Miscellaneous'];
    const descriptions = {
      Donation: ['Friday collection', 'Anonymous donor', 'Family sadaqah'],
      Zakat: ['Ramadan zakat', 'Zakat al-Mal', 'Community zakat drive'],
      'Masjid Fund': ['Building fund', 'Renovation fund', 'General fund'],
      'Other Income': ['Book sale', 'Event ticket sales', 'Rental income'],
      Utilities: ['Electricity bill', 'Water bill', 'Gas bill', 'Internet'],
      Maintenance: ['HVAC repair', 'Plumbing fix', 'Carpet cleaning'],
      Supplies: ['Prayer mats', 'Office supplies', 'Cleaning supplies'],
      Staff: ['Imam salary', 'Custodian salary', 'Admin salary'],
      Events: ['Eid celebration', 'Community iftar', 'Youth program'],
      Miscellaneous: ['Bank fees', 'Insurance', 'Sundry expense'],
    };

    const randomFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randomDateWithinDays = (days) => {
      const now = Date.now();
      const past = now - Math.floor(Math.random() * days) * 24 * 60 * 60 * 1000;
      return new Date(past).toISOString();
    };

    const rows = [];
    for (let i = 0; i < count; i++) {
      const type = Math.random() < 0.4 ? 'income' : 'expense';
      const category = randomFrom(type === 'income' ? incomeCategories : expenseCategories);
      const amount = type === 'income'
        ? Math.round((Math.random() * 950 + 50) * 100) / 100
        : Math.round((Math.random() * 480 + 20) * 100) / 100;

      rows.push([
        uuidv4(),
        type,
        category,
        amount,
        randomFrom(descriptions[category] || ['']),
        randomDateWithinDays(180),
      ]);
    }

    for (const row of rows) {
      await dbRun(
        'INSERT INTO transactions (id, type, category, amount, description, date) VALUES ($1, $2, $3, $4, $5, $6)',
        row
      );
    }

    res.status(201).json({ message: `Seeded ${rows.length} transactions` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction
app.delete('/api/transactions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    await dbRun('DELETE FROM transactions WHERE id = $1', [id]);
    res.json({ message: 'Transaction deleted' });

    if (existing?.member_id) {
      runInBackground(notifyMemberOfTransaction(existing.member_id, 'deleted', existing));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all members (homes)
const PAYMENT_FREQUENCIES = ['monthly', 'yearly'];
const MEMBER_TYPES = ['regular', 'non_rotation'];

function validatePaymentFrequency(paymentFrequency) {
  return paymentFrequency == null || PAYMENT_FREQUENCIES.includes(paymentFrequency);
}

function validateMemberType(memberType) {
  return memberType == null || MEMBER_TYPES.includes(memberType);
}

// Both fields must be set together (or both omitted) - a year without a
// month (or vice versa) can't be resolved to a specific starting month.
function validateDuesStart(duesStartYear, duesStartMonthIndex) {
  if (duesStartYear == null && duesStartMonthIndex == null) return true;
  if (duesStartYear == null || duesStartMonthIndex == null) return false;
  return (
    Number.isInteger(duesStartYear) &&
    Number.isInteger(duesStartMonthIndex) &&
    duesStartMonthIndex >= 0 &&
    duesStartMonthIndex <= 11
  );
}

app.get('/api/members', async (req, res) => {
  try {
    const members = await dbAll(
      `SELECT m.*, COUNT(ps.id) > 0 AS "hasPushSubscription"
       FROM members m
       LEFT JOIN push_subscriptions ps ON ps.member_id = m.id
       GROUP BY m.id
       ORDER BY m.position ASC`
    );
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new member (home) - also creates the paired login (users row) so
// the member can log in with their unique_id + phone immediately.
app.post('/api/members', requireAdmin, async (req, res) => {
  try {
    const { name, address, phone, memberCount, paymentAmount, paymentFrequency, memberType, duesStartYear, duesStartMonthIndex } = req.body;

    if (!name || !address || !phone || !memberCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      return res.status(400).json({ error: 'memberCount must be a positive integer' });
    }
    if (!validatePaymentFrequency(paymentFrequency)) {
      return res.status(400).json({ error: 'paymentFrequency must be "monthly" or "yearly"' });
    }
    if (!validateMemberType(memberType)) {
      return res.status(400).json({ error: 'memberType must be "regular" or "non_rotation"' });
    }
    if (!validateDuesStart(duesStartYear, duesStartMonthIndex)) {
      return res.status(400).json({ error: 'duesStartYear/duesStartMonthIndex must both be set, or both omitted' });
    }

    const id = uuidv4();
    const maxPositionRow = await dbGet('SELECT COALESCE(MAX(position), 0) as max_position FROM members');
    const position = Number(maxPositionRow.max_position) + 1;
    const uniqueId = `MR#${String(position).padStart(3, '0')}`;

    let client;
    try {
      client = await pool.connect();
    } catch (connectError) {
      return res.status(500).json({ error: connectError.message });
    }

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO members (id, unique_id, position, name, address, phone, member_count, payment_amount, payment_frequency, member_type, dues_start_year, dues_start_month)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, uniqueId, position, name, address, phone, memberCount, paymentAmount ?? null, paymentFrequency ?? null, memberType || 'regular', duesStartYear ?? null, duesStartMonthIndex ?? null]
      );
      await client.query(
        'INSERT INTO users (id, username, password_hash, is_admin, member_id) VALUES ($1, $2, NULL, false, $3)',
        [uuidv4(), uniqueId, id]
      );
      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    const newMember = await dbGet('SELECT * FROM members WHERE id = $1', [id]);
    res.status(201).json(newMember);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a member (home) - also used to deactivate/reactivate (soft delete)
// Photos (member photos, About the masjid): a data URL made in the browser.
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO_CHARS = 700000; // ~500 KB of image

// A member's uploaded photo, by member code (MR#001) - public, as the photo
// files always were (today's duty card shows it to visitors). 5 minutes of
// browser cache, then the ETag answers 304 until the photo changes; "none"
// is cached the same, so a list of members does not ask again on every view.
app.get('/api/members/photo/:uniqueId', async (req, res) => {
  try {
    const row = await dbGet(
      'SELECT p.photo, p.updated_at FROM member_photos p JOIN members m ON m.id = p.member_id WHERE m.unique_id = $1',
      [req.params.uniqueId]
    );
    res.set('Cache-Control', 'public, max-age=300');
    const m = row?.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.set('ETag', `"${new Date(row.updated_at).getTime()}"`).type(m[1]).send(Buffer.from(m[2], 'base64'));
  } catch {
    res.status(500).end();
  }
});

// Admin: set (a data URL, resized in the browser) or remove (null) a photo.
app.put('/api/members/:id/photo', requireAdmin, async (req, res) => {
  const photo = req.body?.photo;
  if (photo !== null && (typeof photo !== 'string' || photo.length > MAX_PHOTO_CHARS || !PHOTO_DATA_URL.test(photo))) {
    return res.status(400).json({ error: 'photo: a JPEG, PNG or WebP image up to about 500 KB, or null to remove it' });
  }
  try {
    const member = await dbGet('SELECT id, unique_id FROM members WHERE id = $1', [req.params.id]);
    if (!member) return res.status(404).json({ error: 'no such member' });
    if (photo === null) await dbRun('DELETE FROM member_photos WHERE member_id = $1', [member.id]);
    else {
      await dbRun(
        `INSERT INTO member_photos (member_id, photo, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (member_id) DO UPDATE SET photo = EXCLUDED.photo, updated_at = CURRENT_TIMESTAMP`,
        [member.id, photo]
      );
    }
    res.json({ uniqueId: member.unique_id, hasPhoto: photo !== null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A member who forgot their own password: drop it, so they log in with the
// phone number on their record again (see /api/auth/login).
app.post('/api/members/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const member = await dbGet('SELECT id, phone FROM members WHERE id = $1', [req.params.id]);
    if (!member) return res.status(404).json({ error: 'no such member' });
    if (!member.phone || member.phone.trim() === '') {
      return res.status(400).json({ error: 'This member has no phone number - add one first, it becomes their password' });
    }
    await dbRun('UPDATE users SET password_hash = NULL WHERE member_id = $1 AND is_admin = false', [member.id]);
    res.json({ reset: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone, memberCount, active, paymentAmount, paymentFrequency, memberType, duesStartYear, duesStartMonthIndex } = req.body;

    if (!name || !address || !phone || !memberCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      return res.status(400).json({ error: 'memberCount must be a positive integer' });
    }
    if (!validatePaymentFrequency(paymentFrequency)) {
      return res.status(400).json({ error: 'paymentFrequency must be "monthly" or "yearly"' });
    }
    if (!validateMemberType(memberType)) {
      return res.status(400).json({ error: 'memberType must be "regular" or "non_rotation"' });
    }
    if (!validateDuesStart(duesStartYear, duesStartMonthIndex)) {
      return res.status(400).json({ error: 'duesStartYear/duesStartMonthIndex must both be set, or both omitted' });
    }

    const result = await dbRun(
      `UPDATE members SET name = $1, address = $2, phone = $3, member_count = $4, active = $5,
       payment_amount = $6, payment_frequency = $7, member_type = $8, dues_start_year = $9, dues_start_month = $10 WHERE id = $11`,
      [name, address, phone, memberCount, active !== false, paymentAmount ?? null, paymentFrequency ?? null, memberType || 'regular', duesStartYear ?? null, duesStartMonthIndex ?? null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const updated = await dbGet('SELECT * FROM members WHERE id = $1', [id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A member's own profile, dues standing, and full tagged transaction history.
// Scoped strictly to the logged-in member's own id via the token - never a
// URL/query param - so one member can't view another's dues.
app.get('/api/members/me', requireAuth, async (req, res) => {
  try {
    if (req.user.isAdmin || !req.user.memberId) {
      return res.status(403).json({ error: 'Not a member account' });
    }
    const member = await dbGet(
      `SELECT m.*, COUNT(ps.id) > 0 AS "hasPushSubscription"
       FROM members m
       LEFT JOIN push_subscriptions ps ON ps.member_id = m.id
       WHERE m.id = $1
       GROUP BY m.id`,
      [req.user.memberId]
    );
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(await buildMemberProfilePayload(member));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Monthly paid/missed breakdown for an arbitrary year, for the profile
// page's year-selector (backward/forward through past years). Scoped to the
// logged-in member's own id, same as /api/members/me above.
app.get('/api/members/me/monthly-breakdown', requireAuth, async (req, res) => {
  try {
    if (req.user.isAdmin || !req.user.memberId) {
      return res.status(403).json({ error: 'Not a member account' });
    }
    const year = Number.parseInt(req.query.year, 10);
    if (!Number.isInteger(year)) {
      return res.status(400).json({ error: 'year must be an integer' });
    }
    const member = await dbGet('SELECT * FROM members WHERE id = $1', [req.user.memberId]);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    const today = getMasjidTodayParts();
    const { breakdown, dues } = await computeMonthlyBreakdownForYear(member, year, today);
    res.json({ year, breakdown, dues });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only equivalent of the above, for any member.
app.get('/api/members/:id/monthly-breakdown', requireAdmin, async (req, res) => {
  try {
    const year = Number.parseInt(req.query.year, 10);
    if (!Number.isInteger(year)) {
      return res.status(400).json({ error: 'year must be an integer' });
    }
    const member = await dbGet('SELECT * FROM members WHERE id = $1', [req.params.id]);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    const today = getMasjidTodayParts();
    const { breakdown, dues } = await computeMonthlyBreakdownForYear(member, year, today);
    res.json({ year, breakdown, dues });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only: view any member's profile/dues exactly as that member would see it.
app.get('/api/members/:id/profile', requireAdmin, async (req, res) => {
  try {
    const member = await dbGet(
      `SELECT m.*, COUNT(ps.id) > 0 AS "hasPushSubscription"
       FROM members m
       LEFT JOIN push_subscriptions ps ON ps.member_id = m.id
       WHERE m.id = $1
       GROUP BY m.id`,
      [req.params.id]
    );
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(await buildMemberProfilePayload(member));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's food-supply assignment
app.get('/api/members/today', async (req, res) => {
  try {
    const assignment = await getTodaysAssignment();
    res.json(assignment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get an upcoming schedule preview
app.get('/api/members/schedule', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 60);
    const preview = await getSchedulePreview(days);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read-only yearly calendar: which day of each month every active member is on duty
app.get('/api/members/yearly-schedule', async (req, res) => {
  try {
    const currentYear = Number(todayInMasjidTimezone().slice(0, 4));
    const year = Math.min(Math.max(parseInt(req.query.year, 10) || currentYear, 2000), 2100);
    const data = await getYearlySchedule(year);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or replace a one-time swap override for a specific date
app.post('/api/members/swap', requireAdmin, async (req, res) => {
  try {
    const { date, memberId, reason } = req.body;

    if (!date || !memberId) {
      return res.status(400).json({ error: 'date and memberId are required' });
    }

    const member = await dbGet('SELECT * FROM members WHERE id = $1', [memberId]);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (member.member_type !== 'regular') {
      return res.status(400).json({ error: 'This member is not part of the food-supply rotation' });
    }

    const ctx = await getRotationProjectionContext();
    const result = await applySwapOverride(ctx, date, memberId, reason);
    res.status(result.reverted ? 200 : 201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Swap two dates' assignments with each other in one action - whoever is
// currently on duty (override or computed) on dateA and dateB trade places.
app.post('/api/members/swap/mutual', requireAdmin, async (req, res) => {
  try {
    const { dateA, dateB, reason } = req.body;

    if (!dateA || !dateB) {
      return res.status(400).json({ error: 'dateA and dateB are required' });
    }
    if (dateA === dateB) {
      return res.status(400).json({ error: 'Choose two different dates' });
    }

    const ctx = await getRotationProjectionContext();
    const memberA = await getCurrentAssignedMemberId(ctx, dateA);
    const memberB = await getCurrentAssignedMemberId(ctx, dateB);

    if (!memberA || !memberB) {
      return res.status(400).json({ error: 'Could not determine current assignees for the selected dates' });
    }
    if (memberA === memberB) {
      return res.status(400).json({ error: 'Both dates are already assigned to the same home' });
    }

    const resultA = await applySwapOverride(ctx, dateA, memberB, reason);
    const resultB = await applySwapOverride(ctx, dateB, memberA, reason);

    res.status(201).json({ dateA: resultA, dateB: resultB });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rebase the rotation so the chosen member serves today, and the cycle
// continues in normal round-robin order starting from them going forward.
app.post('/api/members/set-current', requireAdmin, async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) {
      return res.status(400).json({ error: 'memberId is required' });
    }

    const activeMembers = await getActiveMembersOrdered();
    const idx = activeMembers.findIndex((m) => m.id === memberId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Member not found or not active' });
    }

    const rotatedIds = [...activeMembers.slice(idx), ...activeMembers.slice(0, idx)].map((m) => m.id);
    const todayStr = todayInMasjidTimezone();
    const existingState = await dbGet('SELECT cycle_number FROM rotation_state WHERE id = 1');
    const nextCycleNumber = existingState ? existingState.cycle_number + 1 : 1;

    await dbRun(
      `INSERT INTO rotation_state (id, cycle_start_date, cycle_member_ids, cycle_number) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET cycle_start_date = EXCLUDED.cycle_start_date, cycle_member_ids = EXCLUDED.cycle_member_ids, cycle_number = EXCLUDED.cycle_number`,
      [todayStr, JSON.stringify(rotatedIds), nextCycleNumber]
    );

    const assignment = await getTodaysAssignment();
    res.json(assignment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a swap override, reverting that date to the computed default
app.delete('/api/members/swap/:date', requireAdmin, async (req, res) => {
  try {
    const { date } = req.params;
    await dbRun('DELETE FROM schedule_overrides WHERE date = $1', [date]);
    res.json({ message: 'Swap override removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Push notifications ---

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

// Only a member subscribes for themselves, from their own logged-in session -
// an admin browsing another member's profile must not bind their own device
// to that member's reminders.
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  if (req.user.isAdmin || !req.user.memberId) {
    return res.status(403).json({ error: 'Only a member can subscribe to their own reminders' });
  }
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    await dbRun(
      `INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [uuidv4(), req.user.memberId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ message: 'Subscribed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  if (req.user.isAdmin || !req.user.memberId) {
    return res.status(403).json({ error: 'Only a member can manage their own reminders' });
  }
  try {
    // Only remove the endpoint the client currently holds - a member can be
    // subscribed from multiple devices at once, and toggling notifications
    // off on one device must not delete the others' rows. A stale/rotated
    // endpoint from a previous browser session (iOS Safari/PWA push
    // endpoints can rotate) is instead pruned lazily wherever a send to it
    // fails with 404/410 (see sendPushToSubscriptions and friends).
    const { endpoint } = req.body;
    if (endpoint) {
      await dbRun('DELETE FROM push_subscriptions WHERE member_id = $1 AND endpoint = $2', [req.user.memberId, endpoint]);
    } else {
      await dbRun('DELETE FROM push_subscriptions WHERE member_id = $1', [req.user.memberId]);
    }
    res.json({ message: 'Unsubscribed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Called by an external scheduler (no JWT available), guarded by a shared
// secret instead of requireAuth/requireAdmin.
app.post('/api/push/run-daily-check', async (req, res) => {
  if (!CRON_SECRET || req.headers['x-cron-secret'] !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await sendTomorrowAssignmentReminders();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Called daily by the same external scheduler as run-daily-check - only
// actually sends anything on the last day of the month (see
// isLastDayOfMasjidMonth); ?force=true bypasses that gate for manual testing.
app.post('/api/push/run-monthly-dues-check', async (req, res) => {
  if (!CRON_SECRET || req.headers['x-cron-secret'] !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await sendMonthEndDuesReminders({ force: req.query.force === 'true' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Members currently owing a Masjid payment due, for the admin Announcements
// page's "Pending Payments" list.
app.get('/api/admin/pending-dues', requireAdmin, async (req, res) => {
  try {
    const pending = await getPendingDuesMembers();
    res.json(pending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin sends a one-off dues reminder to a single member, on demand.
app.post('/api/push/remind/:memberId', requireAdmin, async (req, res) => {
  try {
    const result = await remindMemberOfDues(req.params.memberId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin sends a dues reminder to every currently-pending member at once.
app.post('/api/push/remind-all-pending', requireAdmin, async (req, res) => {
  try {
    const pending = await getPendingDuesMembers();
    let sent = 0;
    let failed = 0;
    let remindersSent = 0;
    for (const member of pending) {
      const result = await remindMemberOfDues(member.id);
      sent += result.sent || 0;
      failed += result.failed || 0;
      if ((result.sent || 0) > 0) remindersSent += 1;
    }
    res.json({ checked: pending.length, remindersSent, sent, failed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A member's own personal notifications (payment received, dues reminder,
// food-day reminder) - scoped strictly to the logged-in member's own id, so
// one member can never see another's, unlike the public /api/announcements
// broadcast list below. Admin accounts have no memberId and just get [].
app.get('/api/my-notifications', requireAuth, async (req, res) => {
  try {
    if (!req.user.memberId) return res.json([]);
    const notifications = await dbAll(
      'SELECT * FROM member_notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.memberId]
    );
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A member clears their entire own notification history. Placed above the
// :id route so 'clear' isn't matched as an id param.
app.delete('/api/my-notifications/clear', requireAuth, async (req, res) => {
  try {
    if (!req.user.memberId) return res.json({ success: true });
    await dbRun('DELETE FROM member_notifications WHERE member_id = $1', [req.user.memberId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A member deletes one of their own notifications - scoped by member_id in
// the WHERE clause so a member can't delete another member's row by guessing
// its id.
app.delete('/api/my-notifications/:id', requireAuth, async (req, res) => {
  try {
    if (!req.user.memberId) return res.status(404).json({ error: 'Notification not found' });
    await dbRun('DELETE FROM member_notifications WHERE id = $1 AND member_id = $2', [req.params.id, req.user.memberId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Announcement history - public read (any logged-in member or admin can
// read it inside the app after tapping a push notification), admin-only
// send (below).
app.get('/api/announcements', async (req, res) => {
  try {
    const announcements = await dbAll('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50');
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin broadcasts a general announcement to every subscribed device.
app.post('/api/push/announce', requireAdmin, async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }
    const result = await sendAnnouncement(title, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin clears the entire announcement history. Placed above the :id route
// so 'clear' isn't matched as an id param.
app.delete('/api/announcements/clear', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM announcements');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin deletes a single announcement from the history.
app.delete('/api/announcements/:id', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Settings > Help contacts (Masjid Committee / Muaddin / Site Related
// Queries) - public read (shown to every visitor), admin-only edit.
// --- About the masjid (public read, admin edit) ---
const ABOUT_FIELDS = { story: 4000, founded: 30, address: 200, tagline: 160 };
const PEOPLE_GROUPS = ['leadership', 'founders'];

async function aboutText() {
  const rows = await dbAll("SELECT key, value FROM app_settings WHERE key LIKE 'about.%'");
  const about = Object.fromEntries(Object.keys(ABOUT_FIELDS).map((k) => [k, '']));
  for (const { key, value } of rows) {
    const k = key.slice('about.'.length);
    if (k in ABOUT_FIELDS) about[k] = value;
  }
  return about;
}

// The people without their photos: each photo is its own URL, cached by the
// browser, versioned by updated_at so a new photo shows at once.
async function aboutPeople() {
  const rows = await dbAll('SELECT id, group_key, name, role, since, photo IS NOT NULL AS has_photo, updated_at FROM masjid_people ORDER BY position ASC, updated_at ASC');
  return rows.map((p) => ({
    id: p.id,
    group: p.group_key,
    name: p.name,
    role: p.role,
    since: p.since,
    photoUrl: p.has_photo ? `/api/about/people/${p.id}/photo?v=${new Date(p.updated_at).getTime()}` : null,
  }));
}

app.get('/api/about', async (req, res) => {
  try {
    res.json({ ...(await aboutText()), people: await aboutPeople() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/about/people/:id/photo', async (req, res) => {
  try {
    const row = await dbGet('SELECT photo FROM masjid_people WHERE id = $1', [req.params.id]);
    const m = row?.photo?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(m[2], 'base64'));
  } catch {
    res.status(500).end();
  }
});

app.put('/api/admin/about', requireAdmin, async (req, res) => {
  const given = req.body ?? {};
  for (const [k, max] of Object.entries(ABOUT_FIELDS)) {
    if (given[k] !== undefined && (typeof given[k] !== 'string' || given[k].length > max)) {
      return res.status(400).json({ error: `${k}: text up to ${max} characters` });
    }
  }
  try {
    for (const k of Object.keys(ABOUT_FIELDS).filter((k) => given[k] !== undefined)) {
      await dbRun(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [`about.${k}`, given[k].trim()]
      );
    }
    res.json(await aboutText());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A person's fields from a request; `photo`: a data URL, null to remove, or
// left out to keep. Returns { error } or the clean fields.
function personFields(body, partial) {
  const out = {};
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  if (!partial || name !== undefined) {
    if (!name || name.length > 80) return { error: 'name: 1-80 characters' };
    out.name = name;
  }
  for (const [k, max] of [['role', 60], ['since', 30]]) {
    if (body?.[k] !== undefined) {
      if (typeof body[k] !== 'string' || body[k].trim().length > max) return { error: `${k}: up to ${max} characters` };
      out[k] = body[k].trim();
    }
  }
  if (body?.group !== undefined || !partial) {
    if (!PEOPLE_GROUPS.includes(body?.group)) return { error: `group: one of ${PEOPLE_GROUPS.join(', ')}` };
    out.group_key = body.group;
  }
  if (body?.photo !== undefined) {
    if (body.photo !== null && (typeof body.photo !== 'string' || body.photo.length > MAX_PHOTO_CHARS || !PHOTO_DATA_URL.test(body.photo))) {
      return { error: 'photo: a JPEG, PNG or WebP image up to about 500 KB' };
    }
    out.photo = body.photo;
  }
  return out;
}

app.post('/api/admin/about/people', requireAdmin, async (req, res) => {
  const f = personFields(req.body, false);
  if (f.error) return res.status(400).json({ error: f.error });
  try {
    const last = await dbGet('SELECT COALESCE(MAX(position), -1) AS p FROM masjid_people');
    await dbRun(
      'INSERT INTO masjid_people (id, group_key, name, role, since, photo, position) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [uuidv4(), f.group_key, f.name, f.role ?? '', f.since ?? '', f.photo ?? null, Number(last.p) + 1]
    );
    res.status(201).json({ people: await aboutPeople() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/about/people/:id', requireAdmin, async (req, res) => {
  const f = personFields(req.body, true);
  if (f.error) return res.status(400).json({ error: f.error });
  const keys = Object.keys(f);
  if (!keys.length) return res.status(400).json({ error: 'nothing to change' });
  try {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const result = await pool.query(`UPDATE masjid_people SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [req.params.id, ...keys.map((k) => f[k])]);
    if (!result.rowCount) return res.status(404).json({ error: 'no such person' });
    res.json({ people: await aboutPeople() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/about/people/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM masjid_people WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'no such person' });
    res.json({ people: await aboutPeople() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// The order on the page: every id, first to last.
app.put('/api/admin/about/people-order', requireAdmin, async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return res.status(400).json({ error: 'ids: a list of person ids' });
  try {
    for (const [i, id] of ids.entries()) await dbRun('UPDATE masjid_people SET position = $1 WHERE id = $2', [i, id]);
    res.json({ people: await aboutPeople() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await dbAll('SELECT * FROM contacts ORDER BY group_key, position ASC');
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/contacts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await dbRun(
      'UPDATE contacts SET name = $1, phone = $2 WHERE id = $3',
      [name.trim(), phone?.trim() || null, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const updated = await dbGet('SELECT * FROM contacts WHERE id = $1', [id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Usage timeline: record a login/logout/page-visit event. Public/optional-auth
// on purpose - anonymous page visits are logged too, so this can't require a
// token. Responds immediately and enriches the row with IP geolocation in the
// background afterwards, so a slow/failed third-party lookup never delays or
// fails the client's fire-and-forget call.
const ACTIVITY_EVENT_TYPES = ['login', 'logout', 'page_visit'];
app.post('/api/activity/log', optionalAuth, async (req, res) => {
  try {
    const { eventType, path, isPwa } = req.body;
    if (!ACTIVITY_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }
    const id = uuidv4();
    const ip = req.ip || null;
    const { browser, os, deviceType } = parseUserAgent(req.headers['user-agent']);
    await dbRun(
      `INSERT INTO activity_logs
        (id, event_type, path, username, is_admin, member_id, ip, browser, os, device_type, is_pwa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        eventType,
        typeof path === 'string' ? path.slice(0, 200) : null,
        req.user?.username || null,
        req.user ? req.user.isAdmin : null,
        req.user?.memberId || null,
        ip,
        browser,
        os,
        deviceType,
        Boolean(isPwa),
      ]
    );
    res.status(204).end();

    runInBackground(
      getIpGeo(ip)
        .then((geo) => {
          if (!geo) return;
          return dbRun(
            'UPDATE activity_logs SET city = $1, region = $2, country = $3 WHERE id = $4',
            [geo.city, geo.region, geo.country, id]
          );
        })
        .catch((err) => console.warn(`Failed to store geo for activity log ${id}: ${err.message}`))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only usage timeline view, newest first.
app.get('/api/activity', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { eventType, isAdmin } = req.query;

    const conditions = [];
    const params = [];
    if (ACTIVITY_EVENT_TYPES.includes(eventType)) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    }
    // Anonymous visits have is_admin NULL - those count as "non-admin" so the
    // default (unchecked) view still shows guest traffic alongside member logins.
    if (isAdmin === 'true') {
      conditions.push('is_admin = true');
    } else if (isAdmin === 'false') {
      conditions.push('is_admin IS NOT TRUE');
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const events = await dbAll(
      `SELECT * FROM activity_logs ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const totalRow = await dbGet(`SELECT COUNT(*)::int AS count FROM activity_logs ${whereClause}`, params);
    res.json({ events, total: totalRow.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Wipe the entire usage timeline. Must be registered before /api/activity/:id
// below, or Express would match "clear" as an :id and never reach this route.
app.delete('/api/activity/clear', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM activity_logs');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk-delete selected rows (the table's checkbox selection).
app.post('/api/activity/delete', requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    await dbRun('DELETE FROM activity_logs WHERE id = ANY($1)', [ids]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
// --- Read-only API for the AI assistant (/api/ai/*) ---
// The AI chat service (a separate app) answers members' questions from this
// data: "who supplies food today?", "who has pending dues?", "how much was
// spent last month?". Separate from the routes the app's own screens use, so
// a UI change never breaks it, and shaped for the AI: only GET, and only the
// fields it needs - no phone numbers, addresses, push subscriptions, activity
// logs or login data. Access is one long random token (MASJID_AI_TOKEN, set
// on Render), sent as "Authorization: Bearer <token>" - not the admin login,
// so it can only read these endpoints and survives a password change. Without
// MASJID_AI_TOKEN the whole section answers 503. The endpoints are described
// for the AI in aiOpenapi.js (served at /api/ai/openapi.json). The same
// endpoints are also MCP tools at /api/ai/mcp (aiMcp.js), for MCP clients.
// An MCP client used by a person (Claude Code) has neither token: it sends
// the admin's personal MCP token instead (mcp_..., made in Settings), which
// opens /api/ai/mcp only, as that user with their role at the time of use.
//
// Every call also carries the logged-in user it is for (X-User-Token), so
// the answers follow the user's role: the admin sees everything; a member
// sees the duty schedule, announcements and their own dues and payments -
// not other members' dues, the accounts, or other members' transactions.
// That token is NOT the user's login token (30 days, can do admin writes):
// /api/assistant/ask below mints a separate one per question - 5 minutes,
// read-only, signed with a key derived from JWT_SECRET, so requireAuth and
// requireAdmin never accept it, and it is useless outside /api/ai/*.
// A visitor who is not logged in is a guest: only the food-duty schedule
// (today, the coming days, the yearly duty days) - the same as the app shows
// anonymous visitors. Anything else answers 403 "log in".
const MASJID_AI_TOKEN = process.env.MASJID_AI_TOKEN;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

const AI_USER_SECRET = crypto.createHmac('sha256', JWT_SECRET).update('masjid-ai-user-token').digest('base64');
const AI_USER_TOKEN_TTL = '5m';

function aiUserToken(user) {
  if (!user) return jwt.sign({ sub: 'guest', guest: true, isAdmin: false, memberId: null, scope: 'ai-read' }, AI_USER_SECRET, { expiresIn: AI_USER_TOKEN_TTL });
  return jwt.sign({ sub: user.id, isAdmin: Boolean(user.isAdmin), memberId: user.memberId ?? null, scope: 'ai-read' }, AI_USER_SECRET, { expiresIn: AI_USER_TOKEN_TTL });
}
const AI_GUEST_PATHS = new Set(['/me', '/today-duty', '/duty-on-date', '/duty-schedule', '/member-duty-days']);
const AI_GUEST_REFUSAL = 'log in to the masjid app to see this - without logging in, only the food-duty schedule is available';

// The user an AI call is for, from its X-User-Token; throws without a valid one.
function aiUserFrom(req) {
  try {
    const claims = jwt.verify(String(req.get('x-user-token') ?? ''), AI_USER_SECRET);
    if (claims.scope !== 'ai-read') throw new Error('wrong scope');
    return { id: claims.sub, guest: claims.guest === true, isAdmin: claims.isAdmin === true, memberId: claims.memberId ?? null };
  } catch {
    throw new Error('a user token is required (X-User-Token missing or expired)');
  }
}

const MCP_TOKEN_PREFIX = 'mcp_';
const hashMcpToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// A personal MCP token -> its user, with the role read now: a user who is no
// longer admin gets nothing. Throws a status error otherwise.
async function mcpTokenUser(token) {
  const row = await dbGet(
    `SELECT t.id AS token_id, u.id, u.is_admin, u.member_id
     FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
    [hashMcpToken(token)]
  );
  if (!row) throw Object.assign(new Error('unknown or revoked personal MCP token'), { status: 401 });
  if (!row.is_admin) throw Object.assign(new Error('personal MCP tokens are for the admin'), { status: 403 });
  await dbRun('UPDATE mcp_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [row.token_id]);
  return { id: row.id, guest: false, isAdmin: true, memberId: row.member_id ?? null };
}

async function requireAiToken(req, res, next) {
  const bearer = getBearerToken(req) ?? '';
  if (bearer.startsWith(MCP_TOKEN_PREFIX)) {
    if (req.path !== '/mcp') return res.status(401).json({ error: 'a personal MCP token works only on /api/ai/mcp' });
    try {
      req.mcpUser = await mcpTokenUser(bearer);
    } catch (error) {
      return res.status(error.status ?? 500).json({ error: error.status ? error.message : 'Server error' });
    }
    return next();
  }
  if (!MASJID_AI_TOKEN) return res.status(503).json({ error: 'AI access is not configured (MASJID_AI_TOKEN)' });
  const given = getBearerToken(req) ?? '';
  // Compared as hashes with timingSafeEqual, so the time taken says nothing about the token.
  if (!crypto.timingSafeEqual(sha256(given), sha256(MASJID_AI_TOKEN))) {
    return res.status(401).json({ error: 'AI access token required' });
  }
  // The MCP server checks the user per tool call: listing its tools needs none.
  if (req.path === '/openapi.json' || req.path === '/mcp') return next();
  try {
    req.aiUser = aiUserFrom(req);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  if (req.aiUser.guest && !AI_GUEST_PATHS.has(req.path)) {
    return res.status(403).json({ error: AI_GUEST_REFUSAL });
  }
  next();
}

const forbidden = (message) => Object.assign(new Error(message), { status: 403 });
const adminOnly = (req, what) => {
  if (!req.aiUser.isAdmin) throw forbidden(`only the admin can see ${what}`);
};

const ai = express.Router();
ai.use(requireAiToken);

const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const clampInt = (value, min, max, fallback) => Math.min(Math.max(parseInt(value, 10) || fallback, min), max);
const nameOf = (member) => (member ? { id: member.unique_id, name: member.name } : null);
// A member search, in English letters or Malayalam, or a member id
// (nameMatch.js): names are in Malayalam, "Sinu TK" must find "സിനു ടി കെ".
const searchOf = (req) => String(req.query.search ?? '').trim();
// When a search finds nobody: say so, and give every name with an English
// spelling, so the answer can still say who it may be (or that nobody is).
async function noMatchFor(search) {
  const all = await dbAll('SELECT unique_id, name FROM members ORDER BY position ASC');
  return {
    noMatch: `No member name matched "${search}". Names are written in Malayalam; all members are listed with an English spelling - pick the one meant, or say that nobody matches.`,
    allMembers: all.map((m) => ({ id: m.unique_id, name: m.name.trim(), nameInEnglishLetters: toLatin(m.name).trim() })),
  };
}
const aiRoute = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : 'Server error' });
  }
};
// Each endpoint's handler, kept by path: the MCP tools (aiMcp.js) run the same ones.
const aiHandlers = new Map();
const aiGet = (path, fn) => {
  aiHandlers.set(path, fn);
  ai.get(path, aiRoute(fn));
};
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
// Every amount here is in rupees - said once per response. With bare numbers
// ("due": 2100) the AI answered in dollars.
const AMOUNTS_IN = 'INR (Indian rupees, ₹)';
const inRupees = (data) => (Array.isArray(data) ? { amountsIn: AMOUNTS_IN, items: data } : { amountsIn: AMOUNTS_IN, ...data });

ai.get('/openapi.json', (req, res) => res.json(AI_OPENAPI));

aiGet('/today-duty', async () => {
  const a = await getTodaysAssignment();
  return {
    date: a.date,
    weekday: weekdayOf(a.date),
    member: nameOf(a.member),
    swapped: a.swapped,
    ...(a.swapped ? { originallyScheduled: nameOf(a.originalMember) } : {}),
  };
});

// One day, any date: "tomorrow", "this Friday", "on 3 December". Found with
// the planner: for "tomorrow" it asked duty-schedule with days=1, which is
// today only. Dates up to a year ahead use the same day-by-day schedule as
// the app (getSchedulePreview); others the yearly projection.
aiGet('/duty-on-date', async (req) => {
  const date = req.query.date;
  if (!isDateStr(date)) throw badRequest('date must be YYYY-MM-DD');
  const ahead = daysBetweenDates(todayInMasjidTimezone(), date);
  if (ahead >= 0 && ahead < 366) {
    const d = (await getSchedulePreview(ahead + 1))[ahead];
    return { date, weekday: weekdayOf(date), member: nameOf(d.member), ...(d.swapped ? { swapped: true, originallyScheduled: nameOf(d.originalMember) } : {}) };
  }
  const [year, month, day] = date.split('-').map(Number);
  const data = await getYearlySchedule(year);
  const onDuty = data.members.find((m) => m.months[month - 1].some((d) => d.day === day && d.swapped !== 'away'));
  return { date, weekday: weekdayOf(date), member: onDuty ? { id: onDuty.unique_id, name: onDuty.name } : null, note: ahead < 0 ? 'projected from the rotation; past swaps may differ' : undefined };
});

aiGet('/duty-schedule', async (req) => {
  const days = clampInt(req.query.days, 1, 60, 14);
  const preview = await getSchedulePreview(days);
  return preview.map((d) => ({
    date: d.date,
    weekday: weekdayOf(d.date),
    member: nameOf(d.member),
    ...(d.swapped ? { swapped: true, originallyScheduled: nameOf(d.originalMember) } : {}),
  }));
});

aiGet('/member-duty-days', async (req) => {
  const currentYear = Number(todayInMasjidTimezone().slice(0, 4));
  const year = clampInt(req.query.year, 2000, 2100, currentYear);
  const data = await getYearlySchedule(year);
  const monthNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }));
  const found = findMembers(searchOf(req), data.members);
  if (searchOf(req) && !found.length) return { year, ...(await noMatchFor(searchOf(req))) };
  return {
    year,
    members: found.map((m) => ({
      id: m.unique_id,
      name: m.name,
      nameInEnglishLetters: toLatin(m.name).trim(),
      // { "January": [3, 21], ... } - only months with duty days; swaps noted
      dutyDays: Object.fromEntries(
        m.months
          .map((days, i) => [monthNames[i], days.map((d) => (d.swapped ? `${d.day} (swapped ${d.swapped === 'in' ? 'in for' : 'away to'} ${d.otherMemberName})` : d.day))])
          .filter(([, days]) => days.length)
      ),
    })),
  };
});

aiGet('/members', async (req) => {
  const members = await dbAll('SELECT * FROM members ORDER BY position ASC');
  const maySeePlan = (m) => req.aiUser.isAdmin || m.id === req.aiUser.memberId;
  const found = findMembers(searchOf(req), members);
  if (searchOf(req) && !found.length) return noMatchFor(searchOf(req));
  return inRupees(found.map((m) => ({
    id: m.unique_id,
    name: m.name,
    nameInEnglishLetters: toLatin(m.name).trim(),
    people: m.member_count,
    inFoodRotation: m.member_type === 'regular',
    active: m.active,
    // Another member's payment plan is the admin's to see.
    ...(maySeePlan(m) ? { paymentPlan: m.payment_amount != null && m.payment_frequency ? { amount: Number(m.payment_amount), frequency: m.payment_frequency } : null } : {}),
  })));
});

// Who is asking: "my dues", "my next duty" - the member's own record, or the admin.
aiGet('/me', async (req) => {
  if (req.aiUser.guest) return { role: 'guest', note: 'Not logged in - only the food-duty schedule is available' };
  if (!req.aiUser.memberId) return { role: req.aiUser.isAdmin ? 'admin' : 'user', note: 'Not linked to a member household' };
  const m = await dbGet('SELECT * FROM members WHERE id = $1', [req.aiUser.memberId]);
  if (!m) return { role: 'member', note: 'Member record not found' };
  const dueInfo = await computeMemberDueInfo(m, getMasjidTodayParts());
  const schedule = await getSchedulePreview(60);
  return inRupees({
    role: req.aiUser.isAdmin ? 'admin' : 'member',
    id: m.unique_id,
    name: m.name,
    people: m.member_count,
    inFoodRotation: m.member_type === 'regular',
    paymentPlan: m.payment_amount != null && m.payment_frequency ? { amount: Number(m.payment_amount), frequency: m.payment_frequency } : null,
    dues: dueInfo.hasPlan ? { due: Math.max(Number(dueInfo.due) || 0, 0), ...(dueInfo.missedMonths?.length ? { missedMonths: dueInfo.missedMonths } : {}) } : null,
    nextDutyDays: schedule.filter((d) => d.member?.id === m.id).slice(0, 5).map((d) => ({ date: d.date, weekday: weekdayOf(d.date) })),
  });
});

// The admin: everyone who owes. A member: only themselves - and the answer
// says so. Found live: a member asked (in Malayalam) for the list of pending
// payments, got an empty list back - their own, already paid - and was told
// "no members have pending dues", while the admin's page listed many.
// Filtered data must say it is filtered.
const ONLY_YOURS = (what) =>
  `Only the asking member's own ${what} - this member cannot see other members'. ` +
  `The full list is for the admin. An empty list means this member has none, not that nobody has any.`;

aiGet('/pending-dues', async (req) => {
  let pending = (await getPendingDuesMembers()).filter((p) => req.aiUser.isAdmin || p.id === req.aiUser.memberId);
  // One member's dues ("dues of Sinu TK"): found among all members first, so
  // "has no pending dues" and "no such member" are told apart.
  const search = searchOf(req);
  let searched = null;
  if (search) {
    const who = findMembers(search, await dbAll('SELECT id, unique_id, name FROM members ORDER BY position ASC'));
    if (!who.length) return noMatchFor(search);
    // A member asking about someone else: refused, as /dues-by-year does.
    // Before, the list was already cut to the member's own, so the other
    // member came back "hasPendingDues: false" and the answer said they owed
    // nothing (found by the Telegram eval: Abdul owed ₹3000).
    if (!req.aiUser.isAdmin && !who.some((m) => m.id === req.aiUser.memberId)) throw forbidden("only the admin can see other members' dues");
    const ids = new Set(who.map((m) => m.id));
    pending = pending.filter((p) => ids.has(p.id));
    searched = {
      searchedFor: search,
      membersFound: who.map((m) => ({ id: m.unique_id, name: m.name.trim(), hasPendingDues: pending.some((p) => p.id === m.id) })),
    };
  }
  const rows = pending.map((p) => ({
    id: p.unique_id,
    name: p.name,
    nameInEnglishLetters: toLatin(p.name).trim(),
    paymentFrequency: p.payment_frequency,
    due: p.due,
    ...(p.missedMonths?.length ? { missedMonths: p.missedMonths } : {}),
  }));
  if (searched) return inRupees({ ...searched, ...(req.aiUser.isAdmin ? {} : { scope: ONLY_YOURS('dues') }), pending: rows });
  return inRupees(req.aiUser.isAdmin ? rows : { scope: ONLY_YOURS('dues'), pending: rows });
});

// One year's dues, month by month - "my pending for last year", "what did
// Sinu TK owe in 2025". The same calculation as the profile page's year
// selector (computeMonthlyBreakdownForYear). /pending-dues and /me only give
// what is owed now, so a past year had no answer (found by the user). A
// member gets only their own year; the admin any member's (by search), or
// their own household's when they have one.
aiGet('/dues-by-year', async (req) => {
  const today = getMasjidTodayParts();
  const year = Number.parseInt(req.query.year, 10);
  if (!Number.isInteger(year) || year < 2000 || year > today.year + 1) throw badRequest(`year must be a year like ${today.year - 1}`);
  const search = searchOf(req);
  // Every member who still owes for that year - "pending of last year" asked
  // by the admin, who means the whole masjid. Before, that answered 400 (the
  // admin is not one member), so the question got no answer (found by the user).
  const everyone = !search && (req.query.everyone === 'true' || (req.aiUser.isAdmin && !req.aiUser.memberId));
  if (everyone) {
    adminOnly(req, "every member's dues");
    const owing = [];
    let withPlan = 0;
    for (const m of await dbAll('SELECT * FROM members ORDER BY position ASC')) {
      const { breakdown, dues } = await computeMonthlyBreakdownForYear(m, year, today);
      if (!dues.hasPlan) continue;
      withPlan++;
      const due = Math.max(Number(dues.due) || 0, 0);
      if (due <= 0) continue;
      owing.push({
        id: m.unique_id,
        name: m.name.trim(),
        nameInEnglishLetters: toLatin(m.name).trim(),
        due,
        ...(breakdown ? { missedMonths: breakdown.filter((e) => e.status === 'missed').map((e) => e.label) } : {}),
      });
    }
    return inRupees({
      year,
      membersWithAPlan: withPlan,
      membersStillOwing: owing.length,
      totalDue: owing.reduce((sum, o) => sum + o.due, 0),
      members: owing,
      ...(owing.length ? {} : { note: `Every member with a payment plan paid in full for ${year}` }),
    });
  }
  let members;
  if (search) {
    const found = findMembers(search, await dbAll('SELECT * FROM members ORDER BY position ASC'));
    if (!found.length) return noMatchFor(search);
    members = req.aiUser.isAdmin ? found.slice(0, 5) : found.filter((m) => m.id === req.aiUser.memberId);
    if (!members.length) throw forbidden("only the admin can see other members' dues");
  } else if (req.aiUser.memberId) {
    members = [await dbGet('SELECT * FROM members WHERE id = $1', [req.aiUser.memberId])].filter(Boolean);
  } else {
    throw badRequest('say which member (search) - this user is not linked to a member household');
  }
  const results = [];
  for (const m of members) {
    const { breakdown, dues } = await computeMonthlyBreakdownForYear(m, year, today);
    results.push({
      id: m.unique_id,
      name: m.name.trim(),
      nameInEnglishLetters: toLatin(m.name).trim(),
      paymentPlan: m.payment_amount != null && m.payment_frequency ? { amount: Number(m.payment_amount), frequency: m.payment_frequency } : null,
      year,
      ...(dues.hasPlan
        ? {
            expected: dues.expected,
            paid: dues.paid,
            due: Math.max(Number(dues.due) || 0, 0),
            ...(breakdown
              ? {
                  missedMonths: breakdown.filter((e) => e.status === 'missed').map((e) => e.label),
                  partialMonths: breakdown.filter((e) => e.status === 'partial').map((e) => `${e.label} (paid ${e.paidAmount} of ${e.dueAmount})`),
                  paidMonths: breakdown.filter((e) => e.status === 'paid').map((e) => e.label),
                }
              : {}),
          }
        : { note: 'No payment plan for this member' }),
    });
  }
  return inRupees(req.aiUser.isAdmin ? { members: results } : { scope: ONLY_YOURS('dues'), members: results });
});

// The same date-range rule as the app's own summary (dateRangeClause): both
// sides cast to date, since stored dates may be YYYY-MM-DD or full timestamps.
function aiDateRange(req) {
  for (const key of ['startDate', 'endDate']) {
    if (req.query[key] !== undefined && !isDateStr(req.query[key])) throw badRequest(`${key} must be YYYY-MM-DD`);
  }
  return dateRangeClause(req);
}

aiGet('/finance-summary', async (req) => {
  adminOnly(req, "the masjid's accounts");
  const { clause, params } = aiDateRange(req);
  const totals = await dbAll(`SELECT type, SUM(amount) AS total FROM transactions ${clause} GROUP BY type`, params);
  const byCategory = await dbAll(
    `SELECT type, category, COUNT(*) AS count, SUM(amount) AS total FROM transactions ${clause} GROUP BY type, category ORDER BY type, total DESC`,
    params
  );
  const banks = await dbAll(`
    SELECT b.name,
      b.opening_balance
        + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS balance
    FROM banks b LEFT JOIN transactions t ON t.bank_id = b.id
    GROUP BY b.id ORDER BY b.created_at ASC
  `);
  const total = (type) => Number(totals.find((t) => t.type === type)?.total ?? 0);
  return inRupees({
    period: { from: req.query.startDate ?? 'all time', to: req.query.endDate ?? 'today' },
    totalIncome: total('income'),
    totalExpense: total('expense'),
    balance: total('income') - total('expense'),
    byCategory: byCategory.map((c) => ({ type: c.type, category: c.category, count: Number(c.count), total: Number(c.total) })),
    bankBalancesNow: banks.map((b) => ({ bank: b.name, balance: Number(b.balance) })),
  });
});

// Income and expense month by month - "last year's income as a line chart",
// "income vs expense by month". /finance-summary gives one total for the
// whole range, so a chart over time had no points to draw (found by the
// user). Opening balances - money carried over when the books started,
// recorded as income - are left out and named, as on the dashboard.
// Default: the last 12 months, this one included; at most 24 months.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_FINANCE_MONTHS = 24;
aiGet('/finance-by-month', async (req) => {
  adminOnly(req, "the masjid's accounts");
  for (const key of ['startDate', 'endDate']) {
    if (req.query[key] !== undefined && !isDateStr(req.query[key])) throw badRequest(`${key} must be YYYY-MM-DD`);
  }
  const today = getMasjidTodayParts();
  const day = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const start = req.query.startDate ?? day(today.year, today.monthIndex - 11, 1);
  const end = req.query.endDate ?? day(today.year, today.monthIndex + 1, 0);
  if (start > end) throw badRequest('startDate must be on or before endDate');
  const months = [];
  for (let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1; `${y}-${String(m + 1).padStart(2, '0')}` <= end.slice(0, 7); m === 11 ? (y++, (m = 0)) : m++) {
    months.push({ month: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[m]} ${y}`, income: 0, expense: 0 });
  }
  if (months.length > MAX_FINANCE_MONTHS) throw badRequest(`at most ${MAX_FINANCE_MONTHS} months at a time`);
  const rows = await dbAll(
    `SELECT to_char(date::date, 'YYYY-MM') AS month, type, (TRIM(category) ~* '^opening balance$') AS opening, SUM(amount) AS total
     FROM transactions WHERE date::date BETWEEN $1::date AND $2::date GROUP BY 1, 2, 3`,
    [start, end]
  );
  let openingLeftOut = 0;
  for (const r of rows) {
    if (r.opening) {
      openingLeftOut += Number(r.total);
      continue;
    }
    const m = months.find((x) => x.month === r.month);
    if (m && (r.type === 'income' || r.type === 'expense')) m[r.type] += Number(r.total);
  }
  const sum = (k) => months.reduce((t, m) => t + m[k], 0);
  return inRupees({
    period: { from: start, to: end },
    months: months.map((m) => ({ ...m, net: m.income - m.expense })),
    totals: { income: sum('income'), expense: sum('expense'), net: sum('income') - sum('expense') },
    ...(openingLeftOut ? { openingBalancesLeftOut: openingLeftOut, note: 'Opening balances (money carried over when the books started) are not counted as income here' } : {}),
  });
});

// Income and expense day by day - "the last 30 days as a line chart" (the
// admin's ready question). Like /finance-by-month: opening balances left out
// and named, days with nothing are 0. Default: the last 30 days, today
// included; at most 92 days.
const MAX_FINANCE_DAYS = 92;
aiGet('/finance-by-day', async (req) => {
  adminOnly(req, "the masjid's accounts");
  for (const key of ['startDate', 'endDate']) {
    if (req.query[key] !== undefined && !isDateStr(req.query[key])) throw badRequest(`${key} must be YYYY-MM-DD`);
  }
  const DAY_MS = 86400000;
  const end = req.query.endDate ?? todayInMasjidTimezone();
  const start = req.query.startDate ?? new Date(Date.parse(end) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (start > end) throw badRequest('startDate must be on or before endDate');
  const count = Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
  if (count > MAX_FINANCE_DAYS) throw badRequest(`at most ${MAX_FINANCE_DAYS} days at a time`);
  const days = Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.parse(start) + i * DAY_MS);
    return { date: d.toISOString().slice(0, 10), label: `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`, income: 0, expense: 0 };
  });
  const rows = await dbAll(
    `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, type, (TRIM(category) ~* '^opening balance$') AS opening, SUM(amount) AS total
     FROM transactions WHERE date::date BETWEEN $1::date AND $2::date GROUP BY 1, 2, 3`,
    [start, end]
  );
  let openingLeftOut = 0;
  for (const r of rows) {
    if (r.opening) {
      openingLeftOut += Number(r.total);
      continue;
    }
    const d = days.find((x) => x.date === r.day);
    if (d && (r.type === 'income' || r.type === 'expense')) d[r.type] += Number(r.total);
  }
  const sum = (k) => days.reduce((t, d) => t + d[k], 0);
  return inRupees({
    period: { from: start, to: end },
    days: days.map((d) => ({ ...d, net: d.income - d.expense })),
    totals: { income: sum('income'), expense: sum('expense'), net: sum('income') - sum('expense') },
    ...(openingLeftOut ? { openingBalancesLeftOut: openingLeftOut, note: 'Opening balances (money carried over when the books started) are not counted as income here' } : {}),
  });
});

aiGet('/transactions', async (req) => {
  const { clause, params } = aiDateRange(req);
  const where = [clause.replace(/^WHERE /, '').replace(/\bdate::date\b/g, 't.date::date')].filter(Boolean);
  if (req.query.type !== undefined) {
    if (!['income', 'expense'].includes(req.query.type)) throw badRequest('type must be income or expense');
    params.push(req.query.type);
    where.push(`t.type = $${params.length}`);
  }
  // A member sees only their own transactions (their payments).
  if (!req.aiUser.isAdmin) {
    if (!req.aiUser.memberId) throw forbidden('only the admin can see transactions');
    params.push(req.aiUser.memberId);
    where.push(`t.member_id = $${params.length}`);
  }
  if (searchOf(req)) {
    // A member's name in any script (nameMatch.js), or words in the category or description.
    const who = findMembers(searchOf(req), await dbAll('SELECT id, unique_id, name FROM members'));
    params.push(`%${searchOf(req)}%`);
    const textParam = params.length;
    params.push(who.map((m) => m.id));
    where.push(`(t.category ILIKE $${textParam} OR t.description ILIKE $${textParam} OR t.member_id = ANY($${params.length}::text[]))`);
  }
  params.push(clampInt(req.query.limit, 1, 100, 30));
  const rows = await dbAll(
    `SELECT t.date, t.type, t.category, t.amount, t.description, m.name AS member, b.name AS bank
     FROM transactions t
     LEFT JOIN members m ON m.id = t.member_id
     LEFT JOIN banks b ON b.id = t.bank_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.date::date DESC, t.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const list = rows.map((t) => ({
    date: String(t.date).slice(0, 10),
    type: t.type,
    category: t.category,
    amount: Number(t.amount),
    ...(t.description ? { description: t.description } : {}),
    ...(t.member ? { member: t.member } : {}),
    ...(t.bank ? { bank: t.bank } : {}),
  }));
  return inRupees(req.aiUser.isAdmin ? list : { scope: ONLY_YOURS('payments and transactions'), transactions: list });
});

aiGet('/announcements', async (req) => {
  const rows = await dbAll('SELECT title, message, created_at FROM announcements ORDER BY created_at DESC LIMIT $1', [clampInt(req.query.limit, 1, 50, 10)]);
  // The masjid's day, like every other date here - not the UTC day.
  return rows.map((a) => ({ date: todayFormatter.format(new Date(a.created_at)), title: a.title, message: a.message }));
});

// The same endpoints as MCP tools (aiMcp.js). Stateless: POST only - no
// event stream to hold open in a serverless function.
ai.post('/mcp', aiMcpHandler({
  openapi: AI_OPENAPI,
  handlers: aiHandlers,
  // A personal MCP token's user (Claude Code), else the AI service's X-User-Token.
  userFrom: (req) => req.mcpUser ?? aiUserFrom(req),
  guestPaths: AI_GUEST_PATHS,
  guestRefusal: AI_GUEST_REFUSAL,
  info: { name: 'masjid-rahma', title: 'Masjid Rahma', version: '1.0.0' },
}));
ai.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'POST only (stateless MCP server)' }));

app.use('/api/ai', ai);

// --- The assistant chat for logged-in users (/api/assistant/*) ---
// The app's chat screen asks here; this server asks the AI service
// (POST AI_ASK_URL with this app's key, AI_ASK_KEY - never sent to the
// browser), with a 5-minute read-only token for the user (aiUserToken
// above), so the AI service reads /api/ai/* as that user. Each user's
// conversation is kept apart on the AI side ("u-<user id>-<chat>").
// Unset AI_ASK_URL or AI_ASK_KEY: 503, and the app hides the chat.
// Everyone - guest, member, admin - is asked only about the app's data (agent
// connected_apps): the assistant is the masjid's, not a general chatbot, so
// no company handbook, coding or general answers (the user's decision,
// 2026-10-19; before, a logged-in user got the AI service's full agent and a
// member's "what is our rollback process?" was answered from its handbook).
// What each one sees is still their role's: a guest only the duty schedule
// (AI_GUEST_PATHS).
// Every question spends the AI service's free quota, so each user has a
// daily limit (the masjid's day): members 4, visitors 4 per IP address, the
// admin no limit (0). The admin changes them on the Settings page (stored in
// app_settings, used at once); AI_DAILY_LIMIT_MEMBER / _GUEST / _ADMIN are
// only the defaults before that. Counted in Postgres (assistant_usage); a
// question the AI could not answer is given back.
const AI_ASK_URL = process.env.AI_ASK_URL;
const AI_ASK_KEY = process.env.AI_ASK_KEY;
const CHAT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const conversationFor = (req, chatId) => (req.user ? `u-${req.user.id}-${chatId}` : `g-${chatId}`).slice(0, 100);
// Who is asking, for the AI service's usage dashboard (its Command Center):
// the member code ("member:MR001"), "admin", or for a visitor a short code
// made from the IP with a secret - the same for one visitor, but not the IP.
// Never a name.
function aiUserRef(req) {
  if (!req.user) return `guest:${crypto.createHmac('sha256', AI_USER_SECRET).update(String(req.ip ?? '')).digest('hex').slice(0, 10)}`;
  if (req.user.isAdmin && !req.user.memberId) return 'admin';
  const code = String(req.user.username ?? req.user.id).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  return `member:${code || req.user.id}`;
}
const limitSetting = (name, fallback) => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
const DEFAULT_DAILY_LIMIT = {
  admin: limitSetting('AI_DAILY_LIMIT_ADMIN', 0),
  member: limitSetting('AI_DAILY_LIMIT_MEMBER', 4),
  guest: limitSetting('AI_DAILY_LIMIT_GUEST', 4),
};
const LIMIT_ROLES = ['member', 'guest', 'admin'];
const MAX_DAILY_LIMIT = 100;
const assistantAvailable = () => Boolean(AI_ASK_URL && AI_ASK_KEY && MASJID_AI_TOKEN);
const handovers = handoverApi({ AI_ASK_URL, AI_ASK_KEY, dbGet });

// The limits now: the admin's setting for a role, else its default.
async function dailyLimits() {
  const rows = await dbAll("SELECT key, value FROM app_settings WHERE key LIKE 'assistant.daily_limit.%'");
  const limits = { ...DEFAULT_DAILY_LIMIT };
  for (const { key, value } of rows) {
    const role = key.slice('assistant.daily_limit.'.length);
    const n = Number(value);
    if (LIMIT_ROLES.includes(role) && Number.isInteger(n) && n >= 0) limits[role] = n;
  }
  return limits;
}

// Who is counted, and their limit (null = no limit). A guest is counted by
// guestKey: the IP address in the app, the Telegram account in the bot.
async function usageFor(req, guestKey = `ip:${req.ip}`) {
  const role = !req.user ? 'guest' : req.user.isAdmin ? 'admin' : 'member';
  const limits = await dailyLimits().catch(() => DEFAULT_DAILY_LIMIT);
  return { key: req.user ? String(req.user.id) : guestKey, limit: limits[role] || null };
}

// The admin's Settings page: read and change the limits (0 = no limit).
app.get('/api/admin/assistant-settings', requireAdmin, async (req, res) => {
  try {
    res.json({ dailyLimits: await dailyLimits(), defaults: DEFAULT_DAILY_LIMIT, max: MAX_DAILY_LIMIT });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/assistant-settings', requireAdmin, async (req, res) => {
  const given = req.body?.dailyLimits ?? {};
  for (const role of Object.keys(given)) {
    const n = given[role];
    if (!LIMIT_ROLES.includes(role) || !Number.isInteger(n) || n < 0 || n > MAX_DAILY_LIMIT) {
      return res.status(400).json({ error: `dailyLimits.${role}: a whole number from 0 (no limit) to ${MAX_DAILY_LIMIT}` });
    }
  }
  try {
    for (const [role, n] of Object.entries(given)) {
      await dbRun(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [`assistant.daily_limit.${role}`, String(n)]
      );
    }
    res.json({ dailyLimits: await dailyLimits() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Personal MCP tokens (Settings, admin): for MCP clients such as Claude Code
// to read the masjid data as this admin. The token is shown once; only its
// hash is kept. Revoking deletes it, refused from the next request.
app.get('/api/admin/mcp-tokens', requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT t.id, t.name, t.hint, t.created_at, t.last_used_at, u.username
       FROM mcp_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`
    );
    res.json({ tokens: rows.map((t) => ({ id: t.id, name: t.name, hint: t.hint, createdAt: t.created_at, lastUsedAt: t.last_used_at, username: t.username })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/mcp-tokens', requireAdmin, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'name: 1-60 characters, e.g. "Claude Code on my laptop"' });
  try {
    const token = `${MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const id = uuidv4();
    const hint = token.slice(-4);
    await dbRun('INSERT INTO mcp_tokens (id, user_id, name, token_hash, hint) VALUES ($1, $2, $3, $4, $5)', [id, req.user.id, name, hashMcpToken(token), hint]);
    res.status(201).json({ id, name, hint, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/mcp-tokens/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM mcp_tokens WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'no such token' });
    res.json({ revoked: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function usedToday(usage) {
  const row = await dbGet('SELECT count FROM assistant_usage WHERE user_key = $1 AND day = $2', [usage.key, todayInMasjidTimezone()]);
  return row?.count ?? 0;
}
// One question more, if it is within the limit - in one statement, so two
// questions sent at once cannot both take the last one. Returns the new
// count, or null when the limit is reached.
async function takeQuestion(usage) {
  const row = await dbGet(
    `INSERT INTO assistant_usage (user_key, day, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_key, day) DO UPDATE SET count = assistant_usage.count + 1
     WHERE $3::int IS NULL OR assistant_usage.count < $3::int
     RETURNING count`,
    [usage.key, todayInMasjidTimezone(), usage.limit]
  );
  return row ? row.count : null;
}
async function giveQuestionBack(usage) {
  await dbRun('UPDATE assistant_usage SET count = GREATEST(count - 1, 0) WHERE user_key = $1 AND day = $2', [usage.key, todayInMasjidTimezone()]);
}
const remainingOf = (usage, used) => (usage.limit ? { limit: usage.limit, remaining: Math.max(usage.limit - used, 0) } : { limit: null, remaining: null });

// `askingAs`: which login the chat answers for - shown in the chat, so a
// member's view ("only my dues") is never mistaken for the admin's.
// `handover`: for a login, the person who answers "Ask a person" and how many of their replies
// are unread (the badge on the Assistant); null when the AI service could not be asked.
app.get('/api/assistant/status', optionalAuth, async (req, res) => {
  if (!assistantAvailable()) return res.json({ available: false });
  const usage = await usageFor(req);
  const askingAs = !req.user ? { role: 'guest' } : { role: req.user.isAdmin ? 'admin' : 'member', username: req.user.username };
  const handover = req.user
    ? await handovers.list(req.user).then(({ status, body }) => ({ person: HANDOVER_PERSON, newReplies: status === 200 ? body.newReplies ?? 0 : null }))
    : null;
  try {
    res.json({ available: true, askingAs, handover, ...remainingOf(usage, await usedToday(usage)) });
  } catch {
    res.json({ available: true, askingAs, handover, limit: usage.limit, remaining: null });
  }
});

// One question to the AI service for `user` (null = a guest), counted
// against `usage`. Returns { status, body } - shared by the app's chat below
// and the Telegram bot (telegram.js). `display`: what the asker can show
// (the app draws tables and charts; Telegram shows text).
async function askAssistant({ user, usage, question, conversationId, ref, display }) {
  let used;
  try {
    used = await takeQuestion(usage);
  } catch {
    return { status: 500, body: { error: 'Could not check today\'s question count - please try again' } };
  }
  if (used === null) {
    return {
      status: 429,
      body: { error: `You have used today's ${usage.limit} questions - ${user ? 'more tomorrow' : 'log in, or ask again tomorrow'}`, limit: usage.limit, remaining: 0 },
    };
  }
  const mode = { mode: 'multi', agent: 'connected_apps' };
  const giveBack = async (status, body) => {
    await giveQuestionBack(usage).catch(() => {});
    return { status, body: { ...body, ...remainingOf(usage, used - 1) } };
  };
  try {
    const aiRes = await fetch(AI_ASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_ASK_KEY}` },
      body: JSON.stringify({ question, conversationId, ...mode, user: { token: aiUserToken(user), ref, role: !user ? 'guest' : user.isAdmin ? 'admin' : 'member' }, ...(display ? { display } : {}) }),
      // The AI may wait for this server's own /api/ai/* calls (a cold start of this server).
      signal: AbortSignal.timeout(120000),
    });
    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) return giveBack(aiRes.status === 429 ? 429 : 502, { error: data.error ?? 'The assistant could not answer - please try again' });
    // handover.offer: nothing in the records answered it - the chat offers "Ask a person" (handover.js).
    return { status: 200, body: { answer: data.answer, sources: (data.sources ?? []).map((s) => ({ n: s.n, source: s.source, section: s.section })), handover: { offer: Boolean(data.handover?.offer), reason: data.handover?.reason }, ...remainingOf(usage, used) } };
  } catch (error) {
    return giveBack(502, { error: error.name === 'TimeoutError' ? 'The assistant took too long - please try again' : 'The assistant could not be reached' });
  }
}

app.post('/api/assistant/ask', optionalAuth, async (req, res) => {
  if (!assistantAvailable()) return res.status(503).json({ error: 'The assistant is not set up on this server' });
  const question = String(req.body?.question ?? '').trim();
  const chatId = String(req.body?.chatId ?? 'main');
  if (!question || question.length > 2000) return res.status(400).json({ error: 'Ask a question of up to 2000 characters' });
  if (!CHAT_ID.test(chatId)) return res.status(400).json({ error: 'Invalid chatId' });
  // A guest's conversation is known only by its id: the app sends a random
  // one per browser, so two guests never share one ("main" would).
  if (!req.user && chatId.length < 16) return res.status(400).json({ error: 'A guest chat needs a random chatId of 16+ characters' });
  const { status, body } = await askAssistant({
    user: req.user ?? null,
    usage: await usageFor(req),
    question,
    conversationId: conversationFor(req, chatId),
    ref: aiUserRef(req),
    // The chat shows Markdown tables and draws ```chart blocks (AssistantChat.tsx).
    display: { tables: true, charts: true },
  });
  res.status(status).json(body);
});

// Voice input: the recording (raw body, up to 4 MB - about 2 minutes) goes
// to the AI service's speech-to-text; the text comes back to check before
// sending. Not counted as a question, but only for someone with questions
// left today, since it spends the same free quota.
const VOICE_LANGUAGES = new Set(['English', 'Malayalam', 'Hindi', 'Tamil', 'Kannada', 'Telugu', 'Arabic', 'Urdu']);

// A recording -> { status, body: { text, language } } through the AI
// service's speech-to-text. Used by the app's mic button and the Telegram
// bot's voice notes. `lang` is a hint (VOICE_LANGUAGES), else none.
async function transcribeAudio(audio, contentType, lang) {
  const hint = VOICE_LANGUAGES.has(lang) ? `?lang=${encodeURIComponent(lang)}` : '';
  try {
    const aiRes = await fetch(`${AI_ASK_URL.replace(/\/$/, '')}/transcribe${hint}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType || 'audio/webm', Authorization: `Bearer ${AI_ASK_KEY}` },
      body: audio,
      signal: AbortSignal.timeout(60000),
    });
    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) return { status: aiRes.status === 429 ? 429 : 502, body: { error: data.error ?? 'Could not turn the recording into text' } };
    return { status: 200, body: { text: data.text ?? '', language: data.language ?? null } };
  } catch (error) {
    return { status: 502, body: { error: error.name === 'TimeoutError' ? 'Turning the recording into text took too long' : 'The assistant could not be reached' } };
  }
}

app.post('/api/assistant/transcribe', optionalAuth, express.raw({ type: () => true, limit: '4mb' }), async (req, res) => {
  if (!assistantAvailable()) return res.status(503).json({ error: 'The assistant is not set up on this server' });
  const usage = await usageFor(req);
  if (usage.limit && (await usedToday(usage)) >= usage.limit) {
    return res.status(429).json({ error: `You have used today's ${usage.limit} questions`, limit: usage.limit, remaining: 0 });
  }
  if (!req.body?.length) return res.status(400).json({ error: 'No recording received' });
  const { status, body } = await transcribeAudio(req.body, req.get('content-type'), req.query.lang);
  res.status(status).json(body);
});

// Forget one conversation on the AI side ("New chat"). Throws when the AI
// service cannot be reached.
async function forgetConversation(conversationId) {
  await fetch(`${AI_ASK_URL.replace(/\/$/, '')}/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AI_ASK_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
}

app.delete('/api/assistant/chat/:chatId', optionalAuth, async (req, res) => {
  if (!AI_ASK_URL || !AI_ASK_KEY) return res.status(503).json({ error: 'The assistant is not set up on this server' });
  if (!CHAT_ID.test(req.params.chatId)) return res.status(400).json({ error: 'Invalid chatId' });
  try {
    await forgetConversation(conversationFor(req, req.params.chatId));
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: 'The assistant could not be reached' });
  }
});

// The assistant as a Telegram bot (telegram.js): the same questions, roles
// and daily limits as the chat above.
const telegramBot = telegramRouter({
  dbGet, dbAll, dbRun, requireAuth, requireAdmin, runInBackground,
  assistantAvailable, askAssistant, usageFor, usedToday, transcribeAudio, forgetConversation, aiUserRef,
  guestRef: (key) => `guest:${crypto.createHmac('sha256', AI_USER_SECRET).update(key).digest('hex').slice(0, 10)}`,
  handover: handovers, handoverPerson: HANDOVER_PERSON,
});
app.use('/api/telegram', telegramBot);

// "Ask a person" (handover.js): the chat's tickets to a person, and the person's replies.
app.use('/api/assistant', handoverRouter({
  api: handovers,
  requireAuth,
  conversationFor,
  chatIdPattern: CHAT_ID,
  aiTokenMatches: (req) => Boolean(MASJID_AI_TOKEN) && crypto.timingSafeEqual(sha256(getBearerToken(req) ?? ''), sha256(MASJID_AI_TOKEN)),
  notifyUser: telegramBot.notifyUser,
}));

app.get('/health', (req, res) => {
  res.json({ status: 'API is running' });
});

export default app;
