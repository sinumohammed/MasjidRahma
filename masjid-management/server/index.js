import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 5000;
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

// Middleware
app.use(cors(FRONTEND_URL ? { origin: FRONTEND_URL } : {}));
app.use(express.json());

// Postgres connection (Neon requires SSL; local Postgres typically doesn't)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
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
  console.log('Database tables ready');
  await backfillMemberUsers();
  await seedDefaultContacts();
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

// Computes a member's recurring-payment standing. `today` is
// { year, monthIndex } in the masjid's timezone. The current in-progress
// month/year already counts as owed (matches "pay at start of period").
// Monthly plans are always reckoned from January of the current year
// (periodsOwed = months elapsed so far this year), matching the Jan-Dec
// monthly breakdown table (buildMonthlyBreakdown) - not from the member's
// actual join date, so a member who joined mid-year is still expected to
// have "caught up" on the months before they joined. Yearly plans are
// unaffected and still count lifetime periods since the member's join date.
function calculateDues(member, paid, today) {
  if (member.payment_amount == null || !member.payment_frequency) {
    return { hasPlan: false, expected: null, paid, due: null, periodsOwed: null };
  }
  let periodsOwed;
  if (member.payment_frequency === 'monthly') {
    periodsOwed = today.monthIndex + 1;
  } else {
    const start = getMasjidYearMonth(new Date(member.created_at));
    const rawMonthsElapsed = (today.year - start.year) * 12 + (today.monthIndex - start.monthIndex) + 1;
    const monthsElapsed = Math.max(rawMonthsElapsed, 0);
    periodsOwed = Math.ceil(monthsElapsed / 12);
  }
  const expected = Number(member.payment_amount) * periodsOwed;
  return { hasPlan: true, expected, paid, due: expected - paid, periodsOwed };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Full current-year (Jan-Dec) month-by-month breakdown for monthly-plan
// members, always spanning the whole year regardless of when the member
// actually joined. Coverage is cumulative and counted from January of the
// current year, not tied to which month a payment landed in: if `paid`
// covers N months' worth of dues (floor(paid / payment_amount)), the first N
// months of the year are marked paid, regardless of which specific month(s)
// the payments were actually recorded against - so paying ahead of schedule
// shows future months as paid too (an advance). Every month gets one of
// three statuses:
//   - 'paid': covered by cumulative payments (past, current, or future/advance)
//   - 'missed': not covered, and its month has already started (<= today)
//   - 'nil': not covered, and it's still in the future - paying ahead is the
//            member's choice, so an unpaid future month isn't "missed" yet
// The "Amount Due" figure itself (calculateDues) is unaffected by this and
// still counts only the months elapsed since the member's actual join date.
function buildMonthlyBreakdown(member, paid, today) {
  if (member.payment_frequency !== 'monthly') return null;
  const monthlyAmount = Number(member.payment_amount);
  const coveredMonths = monthlyAmount > 0 ? Math.floor(paid / monthlyAmount) : 0;

  const entries = [];
  for (let m = 0; m <= 11; m++) {
    const status = m < coveredMonths ? 'paid' : m <= today.monthIndex ? 'missed' : 'nil';
    entries.push({ year: today.year, monthIndex: m, label: MONTH_LABELS[m], status });
  }
  return entries;
}

// Shared payload builder for both a member viewing their own profile and an
// admin viewing a member's profile via the admin-only lookup route.
async function buildMemberProfilePayload(member) {
  const paidRow = await dbGet(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE member_id = $1 AND category = 'Masjid payment' AND type = 'income'`,
    [member.id]
  );
  const transactions = await dbAll(
    'SELECT * FROM transactions WHERE member_id = $1 ORDER BY date DESC',
    [member.id]
  );
  const today = getMasjidTodayParts();
  const paid = Number(paidRow.total);
  const dues = calculateDues(member, paid, today);
  const monthlyBreakdown = buildMonthlyBreakdown(member, paid, today);
  return { member, dues, monthlyBreakdown, transactions, currentYear: today.year };
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

  const title = 'Masjid Food Day Reminder';
  const body = `You're on food duty tomorrow (${tomorrowStr}).`;
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
  const paidRow = await dbGet(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE member_id = $1 AND category = 'Masjid payment' AND type = 'income'`,
    [member.id]
  );
  const paid = Number(paidRow.total);
  const dues = calculateDues(member, paid, today);
  if (!dues.hasPlan || !dues.due || dues.due <= 0) {
    return { ...dues, paid, missedMonths: null };
  }
  const missedMonths =
    member.payment_frequency === 'monthly'
      ? buildMonthlyBreakdown(member, paid, today)
          .filter((entry) => entry.status === 'missed')
          .map((entry) => entry.label)
      : null;
  return { ...dues, paid, missedMonths };
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
    const token = jwt.sign({ id, username, isAdmin: true, memberId: null }, JWT_SECRET, { expiresIn: '7d' });
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
      { expiresIn: '7d' }
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

// Create new transaction
app.post('/api/transactions', requireAdmin, async (req, res) => {
  try {
    const { type, category, amount, description, date, memberId } = req.body;

    if (!type || !category || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (type === 'income' && category === 'Masjid payment' && !memberId) {
      return res.status(400).json({ error: 'A member must be selected for Masjid payment transactions' });
    }

    const id = uuidv4();
    const transactionDate = date || new Date().toISOString();

    await dbRun(
      'INSERT INTO transactions (id, type, category, amount, description, date, member_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, type, category, amount, description || '', transactionDate, memberId || null]
    );

    const newTransaction = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.status(201).json(newTransaction);

    if (memberId) {
      if (type === 'income' && category === 'Masjid payment') {
        sendPaymentReceivedNotification(memberId, amount);
      } else {
        notifyMemberOfTransaction(memberId, 'added', newTransaction);
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
    const { type, category, amount, description, date, memberId } = req.body;

    if (!type || !category || !amount || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (type === 'income' && category === 'Masjid payment' && !memberId) {
      return res.status(400).json({ error: 'A member must be selected for Masjid payment transactions' });
    }

    const result = await dbRun(
      `UPDATE transactions SET type = $1, category = $2, amount = $3, description = $4, date = $5, member_id = $6
       WHERE id = $7`,
      [type, category, amount, description || '', date, memberId || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updated = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.json(updated);

    if (updated.member_id) {
      notifyMemberOfTransaction(updated.member_id, 'updated', updated);
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
      notifyMemberOfTransaction(existing.member_id, 'deleted', existing);
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
    const { name, address, phone, memberCount, paymentAmount, paymentFrequency, memberType } = req.body;

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
        `INSERT INTO members (id, unique_id, position, name, address, phone, member_count, payment_amount, payment_frequency, member_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, uniqueId, position, name, address, phone, memberCount, paymentAmount ?? null, paymentFrequency ?? null, memberType || 'regular']
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
app.put('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone, memberCount, active, paymentAmount, paymentFrequency, memberType } = req.body;

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

    const result = await dbRun(
      `UPDATE members SET name = $1, address = $2, phone = $3, member_count = $4, active = $5,
       payment_amount = $6, payment_frequency = $7, member_type = $8 WHERE id = $9`,
      [name, address, phone, memberCount, active !== false, paymentAmount ?? null, paymentFrequency ?? null, memberType || 'regular', id]
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
    const member = await dbGet('SELECT * FROM members WHERE id = $1', [req.user.memberId]);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(await buildMemberProfilePayload(member));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only: view any member's profile/dues exactly as that member would see it.
app.get('/api/members/:id/profile', requireAdmin, async (req, res) => {
  try {
    const member = await dbGet('SELECT * FROM members WHERE id = $1', [req.params.id]);
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
    const { endpoint } = req.body;
    await dbRun('DELETE FROM push_subscriptions WHERE endpoint = $1 AND member_id = $2', [endpoint, req.user.memberId]);
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'API is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n✅ Masjid Management API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET    /api/auth/status`);
  console.log(`  POST   /api/auth/setup`);
  console.log(`  POST   /api/auth/login`);
  console.log(`  POST   /api/auth/change-password`);
  console.log(`  GET    /api/transactions`);
  console.log(`  GET    /api/transactions/type/:type`);
  console.log(`  GET    /api/summary`);
  console.log(`  GET    /api/transactions/category/stats`);
  console.log(`  POST   /api/transactions`);
  console.log(`  POST   /api/transactions/seed`);
  console.log(`  PUT    /api/transactions/:id`);
  console.log(`  DELETE /api/transactions/:id`);
  console.log(`  GET    /api/members`);
  console.log(`  POST   /api/members`);
  console.log(`  PUT    /api/members/:id`);
  console.log(`  GET    /api/members/today`);
  console.log(`  GET    /api/members/schedule`);
  console.log(`  GET    /api/members/yearly-schedule`);
  console.log(`  POST   /api/members/swap`);
  console.log(`  DELETE /api/members/swap/:date`);
  console.log(`  POST   /api/members/set-current`);
  console.log(`  GET    /api/push/vapid-public-key`);
  console.log(`  POST   /api/push/subscribe`);
  console.log(`  POST   /api/push/unsubscribe`);
  console.log(`  POST   /api/push/run-daily-check`);
  console.log(`  POST   /api/push/run-monthly-dues-check`);
  console.log(`  GET    /api/admin/pending-dues`);
  console.log(`  POST   /api/push/remind/:memberId`);
  console.log(`  POST   /api/push/remind-all-pending`);
  console.log(`  POST   /api/push/announce`);
  console.log(`  GET    /api/contacts`);
  console.log(`  PUT    /api/contacts/:id`);
});
