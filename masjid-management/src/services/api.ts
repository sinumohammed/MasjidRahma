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
  bank_id: string | null;
}

export interface Bank {
  id: string;
  name: string;
  opening_balance: number;
  balance: number;
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
  isAdmin: boolean;
  memberId: string | null;
}

export type MemberType = 'regular' | 'non_rotation';

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
  member_type: MemberType;
  hasPushSubscription: boolean;
  dues_start_year?: number | null;
  dues_start_month?: number | null;
}

export interface DuesInfo {
  hasPlan: boolean;
  expected: number | null;
  paid: number;
  due: number | null;
  periodsOwed: number | null;
}

export interface MonthlyDueEntry {
  year: number;
  monthIndex: number;
  label: string;
  status: 'paid' | 'missed' | 'nil';
}

export interface MyProfile {
  member: Member;
  dues: DuesInfo;
  monthlyBreakdown: MonthlyDueEntry[] | null;
  transactions: Transaction[];
  currentYear: number;
  joinYear: number;
  maxYear: number;
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
  data: Omit<Transaction, 'id' | 'created_at' | 'member_id' | 'bank_id'> & {
    memberId?: string | null;
    bankId?: string | null;
  }
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
  data: Partial<Omit<Transaction, 'member_id' | 'bank_id'>> & { memberId?: string | null; bankId?: string | null }
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

export const getBanks = async (): Promise<Bank[]> => {
  const response = await fetch(`${API_BASE_URL}/banks`);
  if (!response.ok) throw new Error('Failed to fetch banks');
  return response.json();
};

export const createBank = async (name: string, openingBalance: number): Promise<Bank> => {
  const response = await fetch(`${API_BASE_URL}/banks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, openingBalance }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create bank');
  return result;
};

export const updateBank = async (id: string, name: string, openingBalance: number): Promise<Bank> => {
  const response = await fetch(`${API_BASE_URL}/banks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, openingBalance }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to update bank');
  return result;
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
    memberType?: MemberType;
    duesStartYear?: number | null;
    duesStartMonthIndex?: number | null;
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
    memberType?: MemberType;
    duesStartYear?: number | null;
    duesStartMonthIndex?: number | null;
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

export const getMemberProfile = async (memberId: string): Promise<MyProfile> => {
  const response = await fetch(`${API_BASE_URL}/members/${memberId}/profile`, { headers: { ...authHeaders() } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch member profile');
  return result;
};

export interface MonthlyBreakdownResult {
  year: number;
  breakdown: MonthlyDueEntry[] | null;
  dues: DuesInfo;
}

export const getMyMonthlyBreakdown = async (year: number): Promise<MonthlyBreakdownResult> => {
  const response = await fetch(`${API_BASE_URL}/members/me/monthly-breakdown?year=${year}`, {
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch monthly breakdown');
  return result;
};

export const getMemberMonthlyBreakdown = async (
  memberId: string,
  year: number
): Promise<MonthlyBreakdownResult> => {
  const response = await fetch(`${API_BASE_URL}/members/${memberId}/monthly-breakdown?year=${year}`, {
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch monthly breakdown');
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

export const getVapidPublicKey = async (): Promise<string | null> => {
  const response = await fetch(`${API_BASE_URL}/push/vapid-public-key`);
  if (!response.ok) throw new Error('Failed to fetch VAPID public key');
  const result = await response.json();
  return result.publicKey;
};

export const subscribePush = async (subscription: PushSubscriptionJSON): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(subscription),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to subscribe to push notifications');
};

export const unsubscribePush = async (endpoint: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ endpoint }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to unsubscribe from push notifications');
};

export interface PendingDuesMember {
  id: string;
  unique_id: string;
  name: string;
  phone: string;
  payment_frequency: 'monthly' | 'yearly';
  due: number;
  missedMonths: string[] | null;
  hasPushSubscription: boolean;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  reason?: string;
}

export const getPendingDuesMembers = async (): Promise<PendingDuesMember[]> => {
  const response = await fetch(`${API_BASE_URL}/admin/pending-dues`, { headers: { ...authHeaders() } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch pending dues');
  return result;
};

export const remindMember = async (memberId: string): Promise<PushSendResult> => {
  const response = await fetch(`${API_BASE_URL}/push/remind/${memberId}`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to send reminder');
  return result;
};

export const remindAllPending = async (): Promise<PushSendResult & { checked: number; remindersSent: number }> => {
  const response = await fetch(`${API_BASE_URL}/push/remind-all-pending`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to send reminders');
  return result;
};

export const sendAnnouncement = async (title: string, message: string): Promise<PushSendResult> => {
  const response = await fetch(`${API_BASE_URL}/push/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, message }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to send announcement');
  return result;
};

export interface AnnouncementRecord {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

export interface MemberNotification {
  id: string;
  member_id: string;
  title: string;
  message: string;
  created_at: string;
}

export const getMyNotifications = async (): Promise<MemberNotification[]> => {
  const response = await fetch(`${API_BASE_URL}/my-notifications`, {
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to load notifications');
  return result;
};

export const deleteMyNotification = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/my-notifications/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to delete notification');
  }
};

export const clearMyNotifications = async (): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/my-notifications/clear`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to clear notifications');
  }
};

export const getAnnouncements = async (): Promise<AnnouncementRecord[]> => {
  const response = await fetch(`${API_BASE_URL}/announcements`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to load announcements');
  return result;
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/announcements/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to delete announcement');
  }
};

export const clearAnnouncements = async (): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/announcements/clear`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Failed to clear announcements');
  }
};

export interface Contact {
  id: string;
  group_key: 'committee' | 'muaddin' | 'query';
  name: string;
  phone: string | null;
  position: number;
}

export const getContacts = async (): Promise<Contact[]> => {
  const response = await fetch(`${API_BASE_URL}/contacts`);
  if (!response.ok) throw new Error('Failed to fetch contacts');
  return response.json();
};

export const updateContact = async (id: string, name: string, phone: string | null): Promise<Contact> => {
  const response = await fetch(`${API_BASE_URL}/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, phone }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to update contact');
  return result;
};

// Usage timeline (admin) API Functions

export type ActivityEventType = 'login' | 'logout' | 'page_visit';

export interface ActivityEvent {
  id: string;
  event_type: ActivityEventType;
  path: string | null;
  username: string | null;
  is_admin: boolean | null;
  member_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  is_pwa: boolean;
  created_at: string;
}

// True when the app is running as an installed PWA (standalone display mode)
// rather than a regular browser tab. `navigator.standalone` covers iOS
// Safari, which doesn't support the `display-mode` media query.
export function isRunningAsPwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

// Fire-and-forget usage tracking - failures (offline, ad-blocker, etc.) must
// never surface to the caller or affect the app's normal behavior.
export const logActivity = (eventType: ActivityEventType, path?: string): void => {
  fetch(`${API_BASE_URL}/activity/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ eventType, path: path ?? null, isPwa: isRunningAsPwa() }),
  }).catch(() => {});
};

export const getActivityLog = async (
  params: { limit?: number; offset?: number; eventType?: ActivityEventType; isAdmin?: boolean } = {}
): Promise<{ events: ActivityEvent[]; total: number }> => {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  if (params.eventType) query.set('eventType', params.eventType);
  if (params.isAdmin !== undefined) query.set('isAdmin', String(params.isAdmin));
  const qs = query.toString();
  const response = await fetch(`${API_BASE_URL}/activity${qs ? `?${qs}` : ''}`, { headers: { ...authHeaders() } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch activity log');
  return result;
};

export const deleteActivityEvents = async (ids: string[]): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/activity/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to delete activity events');
};

export const clearActivityLog = async (): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/activity/clear`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to clear activity log');
};
