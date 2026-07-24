import { useEffect, useMemo, useState } from 'react';
import { Row, Col, Spin, Alert, Modal } from 'antd';
import {
  WalletOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  BankOutlined,
  TeamOutlined,
  LockOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getSummary, getCategoryStats, type Summary, type CategoryStat } from '../services/api';
import ChartsPanel from './ChartsPanel';
import TodayAssignmentCard from './Members/TodayAssignmentCard';
import ProfileView from './Members/ProfileView';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const MASJID_PAYMENT_CATEGORY = 'Masjid payment';
const IMAM_SALARY_CATEGORY = 'Imam Salary';
const STAFF_SALARY_CATEGORY = 'Staff Salary';
const SALARY_COLORS = ['#4a3aa7', '#eb6834'];

export interface TransactionFilter {
  type?: 'income' | 'expense';
  category?: string;
}

interface DashboardProps {
  onNavigateToTransactions?: (filter: TransactionFilter) => void;
}

export default function Dashboard({ onNavigateToTransactions }: DashboardProps) {
  const { currencySymbol } = useSettings();
  const { isAdmin, isLoggedIn } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setSummary(null);
      setCategoryStats([]);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [summaryData, statsData] = await Promise.all([getSummary(), getCategoryStats()]);
        setSummary(summaryData);
        setCategoryStats(statsData);
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

  const salaryDonutData = useMemo(
    () =>
      [
        { category: IMAM_SALARY_CATEGORY, total: imamSalaryTotal },
        { category: STAFF_SALARY_CATEGORY, total: staffSalaryOnlyTotal },
      ].filter((entry) => entry.total > 0),
    [imamSalaryTotal, staffSalaryOnlyTotal]
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

  return (
    <>
      <div className="dashboard-container">
        <Row gutter={[24, 24]} className="dashboard-grid" style={{ marginBottom: '24px' }}>
          <Col xs={24}>
            <TodayAssignmentCard />
          </Col>
        </Row>

        {!isAdmin && !isLoggedIn && (
          <div className="dashboard-login-prompt">
            <LockOutlined />
            <span>Log in as an admin to explore financial details, charts, and more.</span>
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

              <div className={`stat-tile balance-tile ${isPositive ? 'positive' : 'negative'}`}>
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
    </>
  );
}
