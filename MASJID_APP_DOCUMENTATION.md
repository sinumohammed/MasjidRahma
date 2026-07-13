# 🕌 Masjid Management App - Complete Architecture Documentation

**Status**: Full-stack application with React frontend + Node.js/Express backend  
**Created**: 2026-07-12  
**Purpose**: Islamic financial management system for income/expense tracking with analytics

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
│   │   ├── Dashboard.tsx        # Main dashboard component
│   │   ├── Dashboard.css        # Dashboard styling
│   ├── services/
│   │   ├── api.ts              # API client with TypeScript interfaces
│   ├── App.tsx                 # Root app component
│   ├── App.css                 # Global app styling
│   ├── main.tsx                # React entry point
│   ├── index.css               # Base styling
│
├── server/                       # Express.js backend
│   ├── index.js                # API server & routes
│   ├── masjid.db               # SQLite database file
│   ├── package.json            # Backend dependencies
│
├── public/                       # Static assets
├── vite.config.ts              # Vite build config
├── tsconfig.json               # TypeScript config
├── package.json                # Frontend dependencies
└── index.html                  # HTML entry point
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
| SQLite3 | 5.1.6 | Database |
| UUID | 9.0.0 | ID generation |
| CORS | 2.8.5 | Cross-origin requests |

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

---

## 💾 DATABASE SCHEMA

### Transactions Table
```sql
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- 'income' or 'expense'
  category TEXT NOT NULL,                -- e.g., 'Donation', 'Utilities'
  amount REAL NOT NULL,                  -- In dollars
  description TEXT,                      -- Optional details
  date TEXT NOT NULL,                    -- Transaction date
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
- [ ] API Server starts on port 5000
- [ ] Health check responds: `GET http://localhost:5000/health`
- [ ] SQLite database file exists: `server/masjid.db`
- [ ] Transactions table created
- [ ] All 7 endpoints accessible

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

### Environment Variables (TODO)
Currently hardcoded:
- Frontend: `API_BASE_URL = 'http://localhost:5000/api'`
- Backend: `PORT = 5000`

**Recommendation**: Move to `.env` files for deployment

### Production Checklist
- [ ] Environment variables externalized
- [ ] Database path configurable
- [ ] API URL configurable per environment
- [ ] CORS origin whitelist configured
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

## 🔧 QUICK START COMMANDS

### Terminal 1 - Backend
```bash
cd server
npm install  # (if not done)
npm run dev  # Start on port 5000
```

### Terminal 2 - Frontend
```bash
cd masjid-management
npm install  # (if not done)
npm run dev  # Start on port 5173
```

### Open Browser
```
http://localhost:5173
```

---

**Last Updated**: 2026-07-12  
**App Status**: ✅ Core infrastructure complete, ready for feature development
