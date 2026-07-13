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
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL;

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
  if (startDate && endDate) {
    return { clause: 'WHERE date BETWEEN $1 AND $2', params: [startDate, endDate] };
  }
  return { clause: '', params: [] };
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

    await dbRun(
      'UPDATE transactions SET type = $1, category = $2, amount = $3, description = $4, date = $5 WHERE id = $6',
      [type, category, amount, description || '', date, id]
    );

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
});
