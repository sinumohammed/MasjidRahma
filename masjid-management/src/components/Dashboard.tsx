import { useEffect, useMemo, useState } from 'react';
import { Row, Col, Spin, Alert, Modal } from 'antd';
import {
  WalletOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  BankOutlined,
  TeamOutlined,
  UserOutlined,
  BellOutlined,
  NotificationOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  getSummary,
  getCategoryStats,
  getMembers,
  getBanks,
  type Summary,
  type CategoryStat,
  type MemberType,
  type Bank,
} from '../services/api';
import ChartsPanel from './ChartsPanel';
import TodayAssignmentCard from './Members/TodayAssignmentCard';
import ProfileView from './Members/ProfileView';
import InlineLoginForm from './InlineLoginForm';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const MASJID_PAYMENT_CATEGORY = 'Masjid payment';
const IMAM_SALARY_CATEGORY = 'Imam Salary';
const STAFF_SALARY_CATEGORY = 'Staff Salary';
const SALARY_COLORS = ['#4a3aa7', '#eb6834'];
const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  regular: 'Regular',
  non_rotation: 'Non-Rotation',
};
const MEMBER_TYPE_COLORS = ['#2a78d6', '#eda100'];
const BANK_COLORS = ['#4a3aa7', '#eb6834', '#2a78d6', '#eda100', '#52c41a', '#cf1322'];

export interface TransactionFilter {
  type?: 'income' | 'expense';
  category?: string;
}

interface DashboardProps {
  onNavigateToTransactions?: (filter: TransactionFilter) => void;
  onNavigateToYearlySchedule?: () => void;
  onNavigateToMembers?: (typeFilter?: MemberType) => void;
  onNavigateToBanks?: (bankId?: string) => void;
  onOpenAnnouncements?: () => void;
  onOpenMyNotifications?: () => void;
  unreadAnnouncements?: number;
  unreadMyNotifications?: number;
}

export default function Dashboard({
  onNavigateToTransactions,
  onNavigateToYearlySchedule,
  onNavigateToMembers,
  onNavigateToBanks,
  onOpenAnnouncements,
  onOpenMyNotifications,
  unreadAnnouncements = 0,
  unreadMyNotifications = 0,
}: DashboardProps) {
  const { currencySymbol } = useSettings();
  const { isAdmin, isLoggedIn } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<MemberType, number>>({ regular: 0, non_rotation: 0 });
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isBanksModalOpen, setIsBanksModalOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setSummary(null);
      setCategoryStats([]);
      setMemberCounts({ regular: 0, non_rotation: 0 });
      setBanks([]);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [summaryData, statsData, membersData, banksData] = await Promise.all([
          getSummary(),
          getCategoryStats(),
          getMembers(),
          getBanks(),
        ]);
        setSummary(summaryData);
        setCategoryStats(statsData);
        setMemberCounts({
          regular: membersData.filter((m) => m.member_type === 'regular').length,
          non_rotation: membersData.filter((m) => m.member_type === 'non_rotation').length,
        });
        setBanks(banksData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load summary');
        console.error('Error loading summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const findCategoryTotal = (category: string, type: 'income' | 'expense') =>
    categoryStats.find((s) => s.category === category && s.type === type)?.total || 0;

  const masjidPaymentTotal = findCategoryTotal(MASJID_PAYMENT_CATEGORY, 'income');
  const imamSalaryTotal = findCategoryTotal(IMAM_SALARY_CATEGORY, 'expense');
  const staffSalaryOnlyTotal = findCategoryTotal(STAFF_SALARY_CATEGORY, 'expense');
  const staffSalaryCombinedTotal = imamSalaryTotal + staffSalaryOnlyTotal;
  const totalMembersCount = memberCounts.regular + memberCounts.non_rotation;

  const salaryDonutData = useMemo(
    () =>
      [
        { category: IMAM_SALARY_CATEGORY, total: imamSalaryTotal },
        { category: STAFF_SALARY_CATEGORY, total: staffSalaryOnlyTotal },
      ].filter((entry) => entry.total > 0),
    [imamSalaryTotal, staffSalaryOnlyTotal]
  );

  const membersDonutData = useMemo(
    () =>
      (['regular', 'non_rotation'] as MemberType[])
        .map((type) => ({ type, count: memberCounts[type] }))
        .filter((entry) => entry.count > 0),
    [memberCounts]
  );

  const banksDonutData = useMemo(
    () => banks.filter((b) => b.balance > 0),
    [banks]
  );

  if (isAdmin && loading) {
    return (
      <div className="dashboard-loading">
        <Spin size="large" tip="Loading dashboard..." />
      </div>
    );
  }

  if (isAdmin && error) {
    return (
      <Alert
        message="Error Loading Dashboard"
        description={error}
        type="error"
        showIcon
        style={{ marginBottom: '20px' }}
      />
    );
  }

  const balance = summary?.balance || 0;
  const isPositive = balance >= 0;

  const navigate = (filter: TransactionFilter) => {
    onNavigateToTransactions?.(filter);
  };

  const handleSalarySliceClick = (category: string) => {
    setIsSalaryModalOpen(false);
    navigate({ type: 'expense', category });
  };

  const handleMembersSliceClick = (type: MemberType) => {
    setIsMembersModalOpen(false);
    onNavigateToMembers?.(type);
  };

  const handleBankSliceClick = (bankId: string) => {
    setIsBanksModalOpen(false);
    onNavigateToBanks?.(bankId);
  };

  return (
    <>
      <div className="dashboard-container">
        <Row gutter={[24, 24]} className="dashboard-grid" style={{ marginBottom: '24px' }}>
          <Col xs={24}>
            <TodayAssignmentCard onOpenYearlySchedule={onNavigateToYearlySchedule} />
          </Col>
        </Row>

        {!isAdmin && !isLoggedIn && <InlineLoginForm />}

        {!isAdmin && isLoggedIn && (
          <div className="notify-split-card">
            <div className="notify-split-half" onClick={onOpenMyNotifications}>
              <BellOutlined className="notify-split-icon" />
              <span className="notify-split-label">Notifications</span>
              {unreadMyNotifications > 0 && (
                <span className="notify-split-badge">{unreadMyNotifications}</span>
              )}
            </div>
            <div className="notify-split-divider" />
            <div className="notify-split-half" onClick={onOpenAnnouncements}>
              <NotificationOutlined className="notify-split-icon" />
              <span className="notify-split-label">Announcements</span>
              {unreadAnnouncements > 0 && (
                <span className="notify-split-badge">{unreadAnnouncements}</span>
              )}
            </div>
          </div>
        )}

        {!isAdmin && isLoggedIn && <ProfileView variant="embedded" />}

        {isAdmin && (
          <>
            {/* Compact stat tiles */}
            <div className="stat-tile-row">
              <div
                className="stat-tile income-tile clickable"
                onClick={() => navigate({ type: 'income' })}
              >
                <div className="stat-tile-icon income-icon">
                  <ArrowUpOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Total Income</span>
                  <span className="stat-tile-value income-value">
                    {currencySymbol}
                    {(summary?.totalIncome || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="stat-tile expense-tile clickable"
                onClick={() => navigate({ type: 'expense' })}
              >
                <div className="stat-tile-icon expense-icon">
                  <ArrowDownOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Total Expenses</span>
                  <span className="stat-tile-value expense-value">
                    {currencySymbol}
                    {(summary?.totalExpense || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className={`stat-tile balance-tile clickable ${isPositive ? 'positive' : 'negative'}`}
                onClick={() => setIsBanksModalOpen(true)}
              >
                <div className={`stat-tile-icon balance-icon ${isPositive ? 'positive' : 'negative'}`}>
                  <WalletOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Current Balance</span>
                  <span className={`stat-tile-value balance-value ${isPositive ? 'positive' : 'negative'}`}>
                    {currencySymbol}
                    {balance.toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="stat-tile masjid-tile clickable"
                onClick={() => navigate({ type: 'income', category: MASJID_PAYMENT_CATEGORY })}
              >
                <div className="stat-tile-icon masjid-icon">
                  <BankOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Total Masjid Payment</span>
                  <span className="stat-tile-value masjid-value">
                    {currencySymbol}
                    {masjidPaymentTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="stat-tile staff-tile clickable"
                onClick={() => setIsSalaryModalOpen(true)}
              >
                <div className="stat-tile-icon staff-icon">
                  <TeamOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Staff Salary</span>
                  <span className="stat-tile-value staff-value">
                    {currencySymbol}
                    {staffSalaryCombinedTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="stat-tile members-tile clickable"
                onClick={() => setIsMembersModalOpen(true)}
              >
                <div className="stat-tile-icon members-icon">
                  <UserOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Members</span>
                  <span className="stat-tile-value members-value">{totalMembersCount}</span>
                </div>
              </div>
            </div>

            {/* Charts */}
            <ChartsPanel />
          </>
        )}
      </div>

      {/* Staff Salary breakdown popup */}
      <Modal
        title="Salary Breakdown"
        open={isSalaryModalOpen}
        onCancel={() => setIsSalaryModalOpen(false)}
        footer={null}
        width={420}
      >
        {salaryDonutData.length === 0 ? (
          <Alert message="No salary transactions recorded yet." type="info" showIcon />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={salaryDonutData}
                  dataKey="total"
                  nameKey="category"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  onClick={(entry) => handleSalarySliceClick((entry as unknown as { category: string }).category)}
                  cursor="pointer"
                >
                  {salaryDonutData.map((entry, index) => (
                    <Cell key={entry.category} fill={SALARY_COLORS[index % SALARY_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value) => `${currencySymbol}${Number(value).toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <p className="salary-modal-hint">Click a segment to view its transactions.</p>
          </>
        )}
      </Modal>

      {/* Members breakdown popup */}
      <Modal
        title="Members Breakdown"
        open={isMembersModalOpen}
        onCancel={() => setIsMembersModalOpen(false)}
        footer={null}
        width={420}
      >
        {membersDonutData.length === 0 ? (
          <Alert message="No members added yet." type="info" showIcon />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={membersDonutData}
                  dataKey="count"
                  nameKey="type"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  onClick={(entry) => handleMembersSliceClick((entry as unknown as { type: MemberType }).type)}
                  cursor="pointer"
                  // label={(entry) => MEMBER_TYPE_LABELS[(entry as unknown as { type: MemberType }).type]}
                >
                  {membersDonutData.map((entry, index) => (
                    <Cell key={entry.type} fill={MEMBER_TYPE_COLORS[index % MEMBER_TYPE_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value, name) => [value, MEMBER_TYPE_LABELS[name as MemberType]]}
                />
                <Legend formatter={(value) => MEMBER_TYPE_LABELS[value as MemberType]} />
              </PieChart>
            </ResponsiveContainer>
            <p className="salary-modal-hint">Click a segment to view those members.</p>
          </>
        )}
      </Modal>

      {/* Bank balances breakdown popup */}
      <Modal
        title="Bank Balances"
        open={isBanksModalOpen}
        onCancel={() => setIsBanksModalOpen(false)}
        footer={null}
        width={420}
      >
        {banksDonutData.length === 0 ? (
          <Alert message="No bank balances to show yet." type="info" showIcon />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={banksDonutData}
                  dataKey="balance"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  onClick={(entry) => handleBankSliceClick((entry as unknown as Bank).id)}
                  cursor="pointer"
                >
                  {banksDonutData.map((entry, index) => (
                    <Cell key={entry.id} fill={BANK_COLORS[index % BANK_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value) => `${currencySymbol}${Number(value).toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <p className="salary-modal-hint">Click a segment to view that bank's transactions.</p>
          </>
        )}
      </Modal>
    </>
  );
}
