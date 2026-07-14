import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
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
  console.log('Database tables ready');
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
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetweenDates(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00Z');
  const to = new Date(toDateStr + 'T00:00:00Z');
  return Math.round((to - from) / 86400000);
}

async function getActiveMembersOrdered() {
  return dbAll('SELECT * FROM members WHERE active = true ORDER BY position ASC');
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

  if (override) {
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
    const swapped = Boolean(overrideMemberId);
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
  const rawState = await ensureRotationState();
  const state = await advanceRotationIfNeeded(rawState);
  const currentCycleMemberIds = JSON.parse(state.cycle_member_ids);
  const currentCycleStart = state.cycle_start_date;

  const activeMembers = await getActiveMembersOrdered();
  const fullActiveIds = activeMembers.map((m) => m.id);

  // If a member has been added/removed but the in-progress cycle hasn't hit
  // its natural boundary yet, project the same continuity-preserving merge
  // that advanceRotationIfNeeded() will apply once that boundary is reached,
  // so future months in this projection already reflect it.
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

  const overrides = await dbAll(
    'SELECT * FROM schedule_overrides WHERE date >= $1 AND date <= $2',
    [`${year}-01-01`, `${year}-12-31`]
  );
  const overrideByDate = new Map(overrides.map((o) => [o.date, o.member_id]));

  const monthsByMemberId = new Map(
    activeMembers.map((m) => [m.id, Array.from({ length: 12 }, () => [])])
  );

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeapYear ? 366 : 365;

  for (let d = 0; d < daysInYear; d++) {
    const dateObj = new Date(Date.UTC(year, 0, 1));
    dateObj.setUTCDate(dateObj.getUTCDate() + d);
    const dateStr = formatDateOnly(dateObj);

    const computedId = boundaryDateStr && dateStr >= boundaryDateStr
      ? computeMemberIdForDate(boundaryDateStr, projectedCycleMemberIds, dateStr)
      : computeMemberIdForDate(currentCycleStart, currentCycleMemberIds, dateStr);

    const overrideMemberId = overrideByDate.get(dateStr);
    const assignedId = overrideMemberId || computedId;
    const months = assignedId && monthsByMemberId.get(assignedId);
    if (months) {
      months[dateObj.getUTCMonth()].push(dateObj.getUTCDate());
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
    const row = await dbGet('SELECT COUNT(*) as count FROM users');
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
    const existing = await dbGet('SELECT COUNT(*) as count FROM users');
    if (Number(existing.count) > 0) {
      return res.status(409).json({ error: 'An admin account already exists' });
    }
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    await dbRun(
      'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)',
      [id, username, passwordHash]
    );
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: admin login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await dbGet('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: change password (must be logged in, must know current password)
app.post('/api/auth/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await dbGet('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
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
    const { type, category, amount, description, date } = req.body;

    if (!type || !category || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    const transactionDate = date || new Date().toISOString();

    await dbRun(
      'INSERT INTO transactions (id, type, category, amount, description, date) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, type, category, amount, description || '', transactionDate]
    );

    const newTransaction = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.status(201).json(newTransaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update transaction
app.put('/api/transactions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, category, amount, description, date } = req.body;

    if (!type || !category || !amount || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await dbRun(
      'UPDATE transactions SET type = $1, category = $2, amount = $3, description = $4, date = $5 WHERE id = $6',
      [type, category, amount, description || '', date, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updated = await dbGet('SELECT * FROM transactions WHERE id = $1', [id]);
    res.json(updated);
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
    await dbRun('DELETE FROM transactions WHERE id = $1', [id]);
    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all members (homes)
app.get('/api/members', async (req, res) => {
  try {
    const members = await dbAll('SELECT * FROM members ORDER BY position ASC');
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new member (home)
app.post('/api/members', requireAdmin, async (req, res) => {
  try {
    const { name, address, phone, memberCount } = req.body;

    if (!name || !address || !phone || !memberCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      return res.status(400).json({ error: 'memberCount must be a positive integer' });
    }

    const id = uuidv4();
    const maxPositionRow = await dbGet('SELECT COALESCE(MAX(position), 0) as max_position FROM members');
    const position = Number(maxPositionRow.max_position) + 1;
    const uniqueId = `MR#${String(position).padStart(3, '0')}`;

    await dbRun(
      'INSERT INTO members (id, unique_id, position, name, address, phone, member_count) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, uniqueId, position, name, address, phone, memberCount]
    );

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
    const { name, address, phone, memberCount, active } = req.body;

    if (!name || !address || !phone || !memberCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      return res.status(400).json({ error: 'memberCount must be a positive integer' });
    }

    const result = await dbRun(
      'UPDATE members SET name = $1, address = $2, phone = $3, member_count = $4, active = $5 WHERE id = $6',
      [name, address, phone, memberCount, active !== false, id]
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

    await dbRun(
      `INSERT INTO schedule_overrides (date, member_id, reason) VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET member_id = EXCLUDED.member_id, reason = EXCLUDED.reason`,
      [date, memberId, reason || null]
    );

    const override = await dbGet('SELECT * FROM schedule_overrides WHERE date = $1', [date]);
    res.status(201).json(override);
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
});
