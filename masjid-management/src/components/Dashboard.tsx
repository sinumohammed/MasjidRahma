import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Alert, Button, Modal, DatePicker, Tooltip } from 'antd';
import { WalletOutlined, ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, LockOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { getSummary, type Summary } from '../services/api';
import TransactionForm from './TransactionForm';
import ChartsPanel from './ChartsPanel';
import TodayAssignmentCard from './Members/TodayAssignmentCard';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const { RangePicker } = DatePicker;
const DATE_FORMAT = 'YYYY-MM-DD';

export default function Dashboard() {
  const { currencySymbol } = useSettings();
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [chartsRefreshKey, setChartsRefreshKey] = useState(0);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(1, 'year'), dayjs()]);

  const rangeParams = {
    startDate: dateRange[0].format(DATE_FORMAT),
    endDate: dateRange[1].format(DATE_FORMAT),
  };

  const handleAddTransactionSuccess = async () => {
    setIsModalOpen(false);
    // Refresh summary data after adding transaction
    try {
      const data = await getSummary(rangeParams);
      setSummary(data);
    } catch (err) {
      console.error('Error refreshing summary:', err);
    }
    setChartsRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    if (!isAdmin) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getSummary(rangeParams);
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load summary');
        console.error('Error loading summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
    // Refresh every 5 minutes
    const interval = setInterval(fetchSummary, 300000);
    return () => clearInterval(interval);
  }, [dateRange, isAdmin]);

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

  return (
    <>
      <div className="dashboard-container">
        {isAdmin && (
          <div className="dashboard-header">
            <div className="dashboard-header-controls">
              <RangePicker
                value={dateRange}
                format={DATE_FORMAT}
                allowClear={false}
                onChange={(range) => {
                  if (range && range[0] && range[1]) {
                    setDateRange([range[0], range[1]]);
                  }
                }}
              />
              <Tooltip title="Add Transaction">
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  size="large"
                  shape="circle"
                  onClick={() => setIsModalOpen(true)}
                  className="dashboard-add-btn"
                />
              </Tooltip>
            </div>
          </div>
        )}

        <Row gutter={[24, 24]} className="dashboard-grid" style={{ marginBottom: '24px' }}>
          <Col xs={24}>
            <TodayAssignmentCard />
          </Col>
        </Row>

        {!isAdmin && (
          <div className="dashboard-login-prompt">
            <LockOutlined />
            <span>Log in as an admin to explore financial details, charts, and more.</span>
          </div>
        )}

        {isAdmin && (
        <>
        <Row gutter={[24, 24]} className="dashboard-grid">
          {/* Total Income Card */}
          <Col xs={24} sm={12} lg={8}>
            <Card 
              className="summary-card income-card"
              hoverable
              bordered={false}
            >
              <div className="card-icon income-icon">
                <ArrowUpOutlined />
              </div>
              <Statistic
                title="Total Income"
                value={summary?.totalIncome || 0}
                prefix={currencySymbol}
                precision={2}
                valueStyle={{ color: '#52c41a', fontSize: '28px', fontWeight: 'bold' }}
              />
              <div className="card-footer">Contributing funds</div>
            </Card>
          </Col>

          {/* Total Expense Card */}
          <Col xs={24} sm={12} lg={8}>
            <Card 
              className="summary-card expense-card"
              hoverable
              bordered={false}
            >
              <div className="card-icon expense-icon">
                <ArrowDownOutlined />
              </div>
              <Statistic
                title="Total Expenses"
                value={summary?.totalExpense || 0}
                prefix={currencySymbol}
                precision={2}
                valueStyle={{ color: '#f5222d', fontSize: '28px', fontWeight: 'bold' }}
              />
              <div className="card-footer">Outgoing funds</div>
            </Card>
          </Col>

          {/* Balance Card */}
          <Col xs={24} sm={12} lg={8}>
            <Card 
              className={`summary-card balance-card ${isPositive ? 'positive' : 'negative'}`}
              hoverable
              bordered={false}
            >
              <div className={`card-icon balance-icon ${isPositive ? 'positive' : 'negative'}`}>
                <WalletOutlined />
              </div>
              <Statistic
                title="Current Balance"
                value={balance}
                prefix={currencySymbol}
                precision={2}
                valueStyle={{ 
                  color: isPositive ? '#1890ff' : '#f5222d', 
                  fontSize: '28px', 
                  fontWeight: 'bold' 
                }}
              />
              <div className="card-footer">
                {isPositive ? 'Healthy surplus' : 'Deficit'}
              </div>
            </Card>
          </Col>
        </Row>

        {/* Quick Stats */}
        <Row gutter={[24, 24]} className="dashboard-grid" style={{ marginTop: '40px' }}>
          <Col xs={24}>
            <Card 
              title="💡 Quick Statistics"
              className="stats-card"
              bordered={false}
            >
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12}>
                  <div className="stat-item">
                    <span className="stat-label">Savings Rate</span>
                    <span className="stat-value">
                      {summary && summary.totalIncome > 0
                        ? ((summary.balance / summary.totalIncome) * 100).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div className="stat-item">
                    <span className="stat-label">Expense Ratio</span>
                    <span className="stat-value">
                      {summary && summary.totalIncome > 0
                        ? ((summary.totalExpense / summary.totalIncome) * 100).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* Charts */}
        <ChartsPanel key={chartsRefreshKey} dateRange={rangeParams} />
        </>
        )}
      </div>

    {/* Add Transaction Modal */}
    <Modal
      title={null}
      open={isModalOpen}
      onCancel={() => setIsModalOpen(false)}
      footer={null}
      width={700}
      bodyStyle={{ padding: 0 }}
      className="transaction-modal"
    >
      <TransactionForm
        onSuccess={handleAddTransactionSuccess}
        onCancel={() => setIsModalOpen(false)}
      />
    </Modal>
    </>
  );
}

