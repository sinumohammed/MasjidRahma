// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const TOKEN_KEY = 'masjid_admin_token';

// Type Definitions
export interface Transaction {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  description: string;
  date: string;
  created_at: string;
}

export interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

export interface CategoryStat {
  category: string;
  type: string;
  count: number;
  total: number;
}

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

export interface AuthResponse {
  token: string;
  username: string;
}

function buildQuery(params: DateRangeParams = {}): string {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Auth API Functions
export const getAuthStatus = async (): Promise<{ hasAdmin: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/auth/status`);
  if (!response.ok) throw new Error('Failed to check admin status');
  return response.json();
};

export const setupAdmin = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch(`${API_BASE_URL}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to create admin account');
  return data;
};

export const loginAdmin = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to log in');
  return data;
};

export const changePassword = async (
  currentPassword: string,
  newPassword: string
): Promise<{ message: string }> => {
  const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to change password');
  return data;
};

// API Functions
export const getTransactions = async (range?: DateRangeParams): Promise<Transaction[]> => {
  const response = await fetch(`${API_BASE_URL}/transactions${buildQuery(range)}`);
  if (!response.ok) throw new Error('Failed to fetch transactions');
  return response.json();
};

export const getTransactionsByType = async (
  type: 'income' | 'expense'
): Promise<Transaction[]> => {
  const response = await fetch(`${API_BASE_URL}/transactions/type/${type}`);
  if (!response.ok) throw new Error(`Failed to fetch ${type} transactions`);
  return response.json();
};

export const getSummary = async (range?: DateRangeParams): Promise<Summary> => {
  const response = await fetch(`${API_BASE_URL}/summary${buildQuery(range)}`);
  if (!response.ok) throw new Error('Failed to fetch summary');
  return response.json();
};

export const getCategoryStats = async (range?: DateRangeParams): Promise<CategoryStat[]> => {
  const response = await fetch(`${API_BASE_URL}/transactions/category/stats${buildQuery(range)}`);
  if (!response.ok) throw new Error('Failed to fetch category stats');
  return response.json();
};

export const createTransaction = async (
  data: Omit<Transaction, 'id' | 'created_at'>
): Promise<Transaction> => {
  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create transaction');
  return response.json();
};

export const updateTransaction = async (
  id: string,
  data: Partial<Transaction>
): Promise<Transaction> => {
  const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update transaction');
  return response.json();
};

export const deleteTransaction = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error('Failed to delete transaction');
};

export const seedTransactions = async (count: number): Promise<{ message: string }> => {
  const response = await fetch(`${API_BASE_URL}/transactions/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ count }),
  });
  if (!response.ok) throw new Error('Failed to generate test data');
  return response.json();
};
