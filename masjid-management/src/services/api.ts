// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
const TOKEN_KEY = 'masjid_admin_token';

// Matches server/index.js's MASJID_TIMEZONE - "today" must be computed the
// same way on the client as on the backend, or a browser in a different
// timezone (or near a day boundary) disagrees with the server on what
// "today" is - e.g. saving a swap for the browser's local "today" while the
// backend's today() is already a day ahead in Kolkata.
const MASJID_TIMEZONE = 'Asia/Kolkata';
const masjidDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MASJID_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface MasjidToday {
  year: number;
  monthIndex: number;
  day: number;
  dateString: string;
}

export function getMasjidToday(): MasjidToday {
  const dateString = masjidDateFormatter.format(new Date());
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, monthIndex: month - 1, day, dateString };
}

// Type Definitions
export interface Transaction {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  description: string;
  date: string;
  created_at: string;
  member_id: string | null;
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
  isAdmin: boolean;
  memberId: string | null;
}

export interface Member {
  id: string;
  unique_id: string;
  position: number;
  name: string;
  address: string;
  phone?: string;
  member_count: number;
  active: boolean;
  created_at: string;
  payment_amount?: number | null;
  payment_frequency?: 'monthly' | 'yearly' | null;
}

export interface DuesInfo {
  hasPlan: boolean;
  expected: number | null;
  paid: number;
  due: number | null;
  periodsOwed: number | null;
}

export interface MyProfile {
  member: Member;
  dues: DuesInfo;
  transactions: Transaction[];
}

export interface Assignment {
  date: string;
  member: Member | null;
  swapped: boolean;
  originalMember?: Member;
}

export interface YearlyScheduleDay {
  day: number;
  swapped?: 'in' | 'away';
  otherMemberName?: string;
}

export interface YearlyScheduleMember {
  id: string;
  unique_id: string;
  name: string;
  months: YearlyScheduleDay[][];
}

export interface YearlySchedule {
  year: number;
  members: YearlyScheduleMember[];
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
  data: Omit<Transaction, 'id' | 'created_at' | 'member_id'> & { memberId?: string | null }
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
  data: Partial<Omit<Transaction, 'member_id'>> & { memberId?: string | null }
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

// Members / food-supply rotation API Functions

export const getMembers = async (): Promise<Member[]> => {
  const response = await fetch(`${API_BASE_URL}/members`, { headers: { ...authHeaders() } });
  if (!response.ok) throw new Error('Failed to fetch members');
  return response.json();
};

export const createMember = async (
  data: {
    name: string;
    address: string;
    phone: string;
    memberCount: number;
    paymentAmount?: number | null;
    paymentFrequency?: 'monthly' | 'yearly' | null;
  }
): Promise<Member> => {
  const response = await fetch(`${API_BASE_URL}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create member');
  return result;
};

export const updateMember = async (
  id: string,
  data: {
    name: string;
    address: string;
    phone: string;
    memberCount: number;
    active: boolean;
    paymentAmount?: number | null;
    paymentFrequency?: 'monthly' | 'yearly' | null;
  }
): Promise<Member> => {
  const response = await fetch(`${API_BASE_URL}/members/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to update member');
  return result;
};

export const getMyProfile = async (): Promise<MyProfile> => {
  const response = await fetch(`${API_BASE_URL}/members/me`, { headers: { ...authHeaders() } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch your profile');
  return result;
};

export const getTodayAssignment = async (): Promise<Assignment> => {
  const response = await fetch(`${API_BASE_URL}/members/today`);
  if (!response.ok) throw new Error('Failed to fetch today\'s assignment');
  return response.json();
};

export const getSchedule = async (days: number = 14): Promise<Assignment[]> => {
  const response = await fetch(`${API_BASE_URL}/members/schedule?days=${days}`);
  if (!response.ok) throw new Error('Failed to fetch schedule');
  return response.json();
};

export const getYearlySchedule = async (year?: number): Promise<YearlySchedule> => {
  const query = year ? `?year=${year}` : '';
  const response = await fetch(`${API_BASE_URL}/members/yearly-schedule${query}`);
  if (!response.ok) throw new Error('Failed to fetch yearly schedule');
  return response.json();
};

export interface SwapResult {
  date: string;
  member_id: string | null;
  reason?: string | null;
  reverted?: boolean;
}

export const createSwap = async (
  date: string,
  memberId: string,
  reason?: string
): Promise<SwapResult> => {
  const response = await fetch(`${API_BASE_URL}/members/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ date, memberId, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create swap');
  return result;
};

export const createMutualSwap = async (
  dateA: string,
  dateB: string,
  reason?: string
): Promise<{ dateA: SwapResult; dateB: SwapResult }> => {
  const response = await fetch(`${API_BASE_URL}/members/swap/mutual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ dateA, dateB, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create mutual swap');
  return result;
};

export const deleteSwap = async (date: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/members/swap/${date}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error('Failed to delete swap');
};

export const setCurrentMember = async (memberId: string): Promise<Assignment> => {
  const response = await fetch(`${API_BASE_URL}/members/set-current`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ memberId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to set current member');
  return result;
};
