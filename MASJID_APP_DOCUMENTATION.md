# 🕌 Masjid Management App - Complete Architecture Documentation

**Status**: ✅ Deployed to production (see [DEPLOYMENT.md](DEPLOYMENT.md) for live URLs and hosting details)
**Created**: 2026-07-12
**Last Updated**: 2026-07-18
**Purpose**: Islamic financial management system for income/expense tracking, member food-supply rotation, and member dues tracking

---

## 🆕 RECENT UPDATES (2026-07-18)

### Member payment/dues report, renamed "My Dues" → "Profile"
`MemberDuesView.tsx` was replaced by `src/components/Members/ProfileView.tsx`, a unified component used both as its own nav page ("Profile", renamed from "My Dues") and embedded inline on the `Dashboard` below `TodayAssignmentCard` for logged-in non-admin members.

- **Monthly-plan members** get a full Jan-Dec table for the current year (always all 12 months, regardless of when the member actually joined). Each month is one of three statuses:
  - `paid` - covered by cumulative payments (coverage is amount-based, not tied to which month a payment was recorded against - e.g. a single ₹600 payment against a ₹200/month plan covers 3 months starting from the earliest unpaid one)
  - `missed` - the month has already started and isn't covered
  - `nil` - a future month that isn't covered (paying ahead is the member's choice, so it isn't "missed" yet)
  - Coverage is always counted from January of the current year (`buildMonthlyBreakdown` in `server/index.js`), not the member's join date - a mid-year joiner is still expected to "catch up" on earlier months.
- **Yearly-plan members** get a list of the current year's `Masjid payment` transactions (date + amount) instead of the monthly grid.
- A single **Credit Balance** stat (`paid - expected`) replaces the old separate "Amount Due"/"Credit Balance" toggle - shown as a signed number, red when negative (owed), green when positive.
- **Admins** get access to the same Profile page (previously member-only) with a member-picker `Select` (defaults to the first member, right-aligned next to the member name/avatar header) that renders any member's profile exactly as that member would see it, via a new admin-only endpoint.
- Backend: `buildMemberProfilePayload(member)` in `server/index.js` is shared by `GET /api/members/me` (self, scoped via JWT) and the new `GET /api/members/:id/profile` (admin-only via `requireAdmin`).

### Member avatar (photo) support
New shared component `src/components/Members/MemberAvatar.tsx` (+ `.css`) resolves a member's photo from `/assets/members/{unique_id-with-punctuation-stripped}.{png,jpg,jpeg}` (tried in that order), falling back to a generic person icon (`UserOutlined` by default, overridable via `fallbackIcon` prop) if none of the three extensions load. Used in:
- `TodayAssignmentCard.tsx` (56px, replacing its old locally-defined avatar logic - now falls back to the same generic icon as everywhere else, not a home icon)
- `ProfileView.tsx` (72px, header row alongside the admin member-picker)
- `App.tsx` header (22px, replacing the generic user icon for non-admin members only; admins keep the generic icon)

Callers must pass `key={uniqueId}` so React remounts the component (rather than updating it in place) when the member changes, avoiding a stale-icon flash mid-switch.

### Settings page Help section
`SettingsPage.tsx` gained a "Help" card with masjid committee and muaddin contact numbers (tap-to-call `tel:` links), plus a site-related-queries contact. Visible to everyone (Settings isn't admin-gated).

---

## 📋 TABLE OF CONTENTS
1. [Project Structure](#project-structure)
2. [Technology Stack](#technology-stack)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [API Endpoints](#api-endpoints)
6. [Database Schema](#database-schema)
7. [Type System & Interfaces](#type-system--interfaces)
8. [Component Tree](#component-tree)
9. [Known Issues & Fixes](#known-issues--fixes)
10. [Testing Checklist](#testing-checklist)
11. [Deployment Readiness](#deployment-readiness)

---

## 📁 PROJECT STRUCTURE

```
masjid-management/
├── src/                          # React frontend
│   ├── components/
│   │   ├── Dashboard.tsx/.css       # Main dashboard
│   │   ├── TransactionForm.tsx/.css # Add/edit transaction modal form
│   │   ├── TransactionsList.tsx/.css# Transaction table (filter/edit/delete)
│   │   ├── ChartsPanel.tsx/.css     # Recharts visualizations
│   │   ├── SettingsPage.tsx/.css    # Settings / admin password change
│   │   ├── AuthModal.tsx            # Admin login / first-time setup modal
│   ├── context/
│   │   ├── AuthContext.tsx          # Admin auth/session state
│   │   ├── SettingsContext.tsx      # App-wide settings state
│   ├── services/
│   │   ├── api.ts              # API client with TypeScript interfaces
│   ├── App.tsx                 # Root app component
│   ├── App.css                 # Global app styling
│   ├── main.tsx                # React entry point
│   ├── index.css               # Base styling
│
├── server/                       # Express.js backend
│   ├── index.js                # API server & routes (Postgres via `pg`)
│   ├── package.json            # Backend dependencies
│   ├── .env.example             # DATABASE_URL / JWT_SECRET / FRONTEND_URL / PORT
│
├── public/                       # Static assets
├── vite.config.ts              # Vite build config
├── tsconfig.json               # TypeScript config
├── package.json                # Frontend dependencies
├── .env.example                 # VITE_API_URL
└── index.html                  # HTML entry point

render.yaml                      # Render Blueprint (repo root)
DEPLOYMENT.md                    # Hosting/deploy reference (repo root)
```

---

## 🛠 TECHNOLOGY STACK

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2.7 | UI framework |
| TypeScript | 6.0.2 | Type safety |
| Vite | 5.4.21 | Build tool & dev server |
| Ant Design | 6.5.0 | UI component library |
| Recharts | 3.9.2 | Charting library |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.17.0 | Runtime |
| Express.js | 4.18.2 | REST API server |
| PostgreSQL (`pg`) | 8.13.1 | Database (hosted on Neon) |
| UUID | 9.0.0 | ID generation |
| CORS | 2.8.5 | Cross-origin requests (restricted via `FRONTEND_URL`) |
| bcryptjs | 2.4.3 | Password hashing for admin auth |
| jsonwebtoken | 9.0.2 | Admin session tokens |
| dotenv | 16.4.7 | Loads `.env` in local development |

> Migrated from SQLite to Postgres for production hosting — free hosts like Render don't persist a SQLite file's disk across redeploys, so the app needs a real hosted database. See [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🎨 FRONTEND ARCHITECTURE

### Entry Point: `main.tsx`
```typescript
- Imports React StrictMode
- Renders App component into #root DOM element
```

### Root Component: `App.tsx` ✅ CLEAN
**Status**: Fully functional, no boilerplate code

**Structure**:
```typescript
- State: activeKey (tracks current menu selection)
- Menu items: Dashboard, Transactions, Settings
- renderContent(): Switch statement returns appropriate component
- Layout: Sider (sidebar), Header, Content, Footer
```

**Menu Items**:
1. Dashboard → Shows Dashboard component
2. Transactions → Placeholder "coming soon"
3. Settings → Placeholder "coming soon"

**Key Features**:
- Sidebar with Ant Design Sider
- Header with title
- Dynamic content rendering based on menu selection
- Professional styling with gradients

---

## 🔌 BACKEND ARCHITECTURE

### API Server: `server/index.js`

**Initialization**:
- Express app created
- CORS middleware enabled
- JSON body parser enabled
- SQLite database initialized at `masjid.db`

**Database Setup**:
- Transactions table created with columns:
  - id (TEXT PRIMARY KEY)
  - type (income/expense)
  - category
  - amount
  - description
  - date
  - created_at (auto-timestamp)

**Helper Functions**:
- `dbRun(query, params)`: Execute INSERT/UPDATE/DELETE
- `dbAll(query, params)`: Fetch multiple rows
- `dbGet(query, params)`: Fetch single row

---

## 📡 API ENDPOINTS

### Auth

```
GET  /api/auth/status               → { hasAdmin: boolean }
POST /api/auth/setup                → { username, password } → { token, username } (only works once, before any admin exists)
POST /api/auth/login                → { username, password } → { token, username }
POST /api/auth/change-password      → (requires admin token) { currentPassword, newPassword } → { message }
```

Write endpoints below (`POST`/`PUT`/`DELETE` on `/api/transactions*`) require an `Authorization: Bearer <token>` header from a logged-in admin.

### 1. Get All Transactions
```
GET /api/transactions
Response: Transaction[]
```

### 2. Get Transactions by Type
```
GET /api/transactions/type/:type
Params: type = 'income' | 'expense'
Response: Transaction[]
```

### 3. Get Financial Summary ⭐ PRIMARY
```
GET /api/summary
Response: {
  totalIncome: number,
  totalExpense: number,
  balance: number
}
```

### 4. Get Category Statistics
```
GET /api/transactions/category/stats
Response: CategoryStat[]
```

### 5. Create Transaction
```
POST /api/transactions
Body: {
  type: 'income' | 'expense',
  category: string,
  amount: number,
  description?: string,
  date?: string
}
Response: Transaction
```

### 6. Update Transaction
```
PUT /api/transactions/:id
Body: Partial<Transaction>
Response: Transaction
```

### 7. Delete Transaction
```
DELETE /api/transactions/:id
Response: { message: "Transaction deleted" }
```

### 8. Health Check
```
GET /health
Response: { status: "API is running" }
```

### 9. Seed Test Data
```
POST /api/transactions/seed
Body: { count?: number }  // 1-500, default 50
Response: { message: "Seeded N transactions" }
```

### Members & Food-Supply Rotation
```
GET  /api/members                     → Member[] (public)
POST /api/members                     → (admin) create a member
PUT  /api/members/:id                 → (admin) update a member

GET  /api/members/me                  → (member, self only) { member, dues, monthlyBreakdown, transactions, currentYear }
GET  /api/members/:id/profile         → (admin only) same shape as /me, for any member - powers the admin "view as member" picker

GET  /api/members/today               → Assignment (today's food-supply home, public)
GET  /api/members/schedule?days=N     → Assignment[] (public preview, 1-60 days)
GET  /api/members/yearly-schedule?year=YYYY → YearlySchedule (public)
POST /api/members/swap                → (admin) one-time swap override for a date
POST /api/members/swap/mutual         → (admin) swap two dates with each other
POST /api/members/set-current         → (admin) fast-forward rotation to a member
DELETE /api/members/swap/:date        → (admin) revert a date's override
```

`GET /api/members/me` and `GET /api/members/:id/profile` share a `buildMemberProfilePayload(member)` helper in `server/index.js`. `dues` comes from `calculateDues()` (expected vs. paid, based on `Masjid payment`/`income` transactions tagged to the member). `monthlyBreakdown` is only populated for `payment_frequency: 'monthly'` members (see `buildMonthlyBreakdown()`); yearly-plan members get `monthlyBreakdown: null` and the frontend derives a payments list from `transactions` instead.

---

## 💾 DATABASE SCHEMA

Hosted on Neon (Postgres). Tables are created automatically on server startup (`initializeDatabase()` in `index.js`).

### Transactions Table
```sql
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- 'income' or 'expense'
  category TEXT NOT NULL,                -- e.g., 'Donation', 'Utilities'
  amount REAL NOT NULL,                  -- In dollars
  description TEXT,                      -- Optional details
  date TEXT NOT NULL,                    -- Transaction date
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### Users Table (admin auth)
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**Indexes**: None yet (add for performance optimization)

---

## 🔤 TYPE SYSTEM & INTERFACES

### `src/services/api.ts` ✅ ALL TYPES PROPERLY EXPORTED

#### Transaction Interface
```typescript
export interface Transaction {
  id: string;                      // UUID
  type: 'income' | 'expense';      // Transaction type
  category: string;                // Category name
  amount: number;                  // Dollar amount
  description: string;             // Optional description
  date: string;                    // Transaction date ISO string
  created_at: string;              // Creation timestamp
}
```

#### Summary Interface ⭐ USED IN DASHBOARD
```typescript
export interface Summary {
  totalIncome: number;             // Sum of all income
  totalExpense: number;            // Sum of all expenses
  balance: number;                 // Income - Expenses
}
```

#### CategoryStat Interface
```typescript
export interface CategoryStat {
  category: string;
  type: string;
  count: number;
  total: number;
}
```

### API Client Functions (All Exported)
```typescript
export const getSummary = async (): Promise<Summary>
export const getTransactions = async (): Promise<Transaction[]>
export const getTransactionsByType = async (type: 'income'|'expense'): Promise<Transaction[]>
export const getCategoryStats = async (): Promise<CategoryStat[]>
export const createTransaction = async (data: Omit<Transaction, 'id'|'created_at'>): Promise<Transaction>
export const updateTransaction = async (id: string, data: Partial<Transaction>): Promise<Transaction>
export const deleteTransaction = async (id: string): Promise<void>
```

---

## 🌳 COMPONENT TREE

```
App (root)
├── Layout.Sider (sidebar)
│   ├── app-logo (Masjid text)
│   └── Menu
│       ├── Dashboard item
│       ├── Transactions item
│       └── Settings item
├── Layout.Header (top bar)
│   └── Title text
├── Layout.Content (main area)
│   └── renderContent() → Dynamic
│       ├── Dashboard (when 'dashboard' selected)
│       ├── Placeholder (when 'transactions' selected)
│       └── Placeholder (when 'settings' selected)
└── Layout.Footer (bottom)

Dashboard Component
├── Summary Cards (Row x3 columns)
│   ├── Income Card
│   │   ├── ArrowUpOutlined icon
│   │   ├── Statistic (totalIncome)
│   │   └── "Contributing funds" label
│   ├── Expense Card
│   │   ├── ArrowDownOutlined icon
│   │   ├── Statistic (totalExpense)
│   │   └── "Outgoing funds" label
│   └── Balance Card
│       ├── DollarOutlined icon
│       ├── Statistic (balance)
│       └── "Healthy surplus/Deficit" label
└── Quick Stats Card (Row x2 columns)
    ├── Savings Rate %
    └── Expense Ratio %
```

---

## 🔍 KNOWN ISSUES & FIXES

### ✅ FIXED ISSUES

#### Issue 1: App.tsx Boilerplate Code
- **Problem**: JSX parse error at line 156:6 - orphaned JSX elements after export
- **Root Cause**: Vite scaffolding boilerplate left in file
- **Solution**: Completely recreated App.tsx with clean code
- **Status**: ✅ RESOLVED

#### Issue 2: Module Export Error (api.ts)
- **Problem**: "does not provide an export named 'Summary'"
- **Root Cause**: Module cache corruption + TypeScript compilation
- **Solution**: Deleted and recreated api.ts with proper exports
- **Status**: ✅ RESOLVED

#### Issue 3: Vite Rolldown Native Binding
- **Problem**: "Cannot find native binding for Rolldown"
- **Root Cause**: Node 20.17.0 below minimum for Rolldown
- **Solution**: Downgraded Vite to v5, plugin-react to v4
- **Status**: ✅ RESOLVED

#### Issue 4: Port 5000 In Use
- **Problem**: Backend API couldn't bind to port 5000
- **Root Cause**: Previous Node.js process not killed
- **Solution**: Used `taskkill /F /IM node.exe`
- **Status**: ✅ RESOLVED

### ⚠️ CURRENT VALIDATION NEEDED

**Import Statement Analysis** (Dashboard.tsx line 4):
```typescript
import { getSummary, type Summary } from '../services/api';
```

- ✅ `getSummary` - async function, EXPORTED in api.ts
- ✅ `type Summary` - interface, EXPORTED in api.ts  
- ✅ `type` keyword - correct TypeScript type-only import syntax
- ✅ Path `../services/api` - correct relative path

**Status**: ✅ CORRECT - All imports should resolve properly

---

## ✅ TESTING CHECKLIST

### Backend Verification
- [ ] API Server starts on port 5000 (local) or Render's assigned port (prod)
- [ ] Health check responds: `GET /health`
- [ ] Connects to Postgres (Neon in prod, local Postgres or Neon branch for dev)
- [ ] Transactions and users tables created
- [ ] All endpoints accessible (see [API Endpoints](#api-endpoints))

### Frontend Verification  
- [ ] Dev server starts on port 5173
- [ ] Page loads without console errors
- [ ] Sidebar renders with 3 menu items
- [ ] Dashboard component displays
- [ ] 3 summary cards visible (Income, Expenses, Balance)
- [ ] Quick Stats section visible
- [ ] All values show $0.00 (empty database expected)
- [ ] No TypeScript compile errors

### Integration Verification
- [ ] Frontend connects to backend without CORS errors
- [ ] `getSummary()` API call succeeds
- [ ] Summary data populates dashboard cards
- [ ] Dashboard refreshes every 30 seconds
- [ ] Error states display gracefully if API unavailable

### Type Safety
- [ ] TypeScript compilation succeeds
- [ ] No "does not provide export" errors
- [ ] All interfaces resolve correctly
- [ ] IDE autocomplete works for api.ts exports

---

## 🚀 DEPLOYMENT READINESS

**✅ Deployed.** Full hosting setup, live URLs, environment variables, and redeploy instructions now live in [DEPLOYMENT.md](DEPLOYMENT.md) — this section just covers local build commands.

### Frontend Build
```bash
npm run build
# Creates: dist/ folder with optimized bundle
```

### Backend Build
```bash
# No build required - Node.js runs directly
npm start
```

### Environment Variables
No longer hardcoded — both frontend and backend read from environment variables (`.env.example` files provided in each). See [DEPLOYMENT.md](DEPLOYMENT.md) for the full list and production values.

### Production Checklist
- [x] Environment variables externalized
- [x] Database migrated off local disk to hosted Postgres (Neon)
- [x] API URL configurable per environment (`VITE_API_URL`)
- [x] CORS origin whitelist configured (`FRONTEND_URL`)
- [ ] Database backups automated
- [ ] Error logging implemented
- [ ] Performance monitoring added
- [ ] Security headers added

---

## 📝 NEXT FEATURES TO IMPLEMENT

1. **Transaction Form Component** - Add income/expense entries
2. **Chart Visualizations** - Recharts pie/bar charts
3. **Transaction List** - Table with edit/delete
4. **Transactions Page** - Replace placeholder
5. **Settings Page** - Configuration options
6. **Mobile Responsiveness** - Test all breakpoints
7. **Test Data Generator** - Populate sample data
8. **Analytics Dashboard** - Advanced metrics

---

## 🔧 QUICK START COMMANDS (Local Development)

### Terminal 1 - Backend
```bash
cd masjid-management/server
npm install                     # (if not done)
cp .env.example .env            # fill in DATABASE_URL (Neon or local Postgres), JWT_SECRET
npm run dev                     # Start on port 5000
```

### Terminal 2 - Frontend
```bash
cd masjid-management
npm install                     # (if not done)
cp .env.example .env            # optional locally; falls back to http://<host>:5000/api if unset
npm run dev                     # Start on port 5173
```

### Open Browser
```
http://localhost:5173
```

For production URLs and deployment steps, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

**Last Updated**: 2026-07-18
**App Status**: ✅ Deployed to production (Vercel + Render + Neon) — see [DEPLOYMENT.md](DEPLOYMENT.md)
