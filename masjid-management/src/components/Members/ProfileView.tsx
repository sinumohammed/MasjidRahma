import { useEffect, useState } from 'react';
import { Card, Table, Tag, Spin, Alert, Statistic, Row, Col, Select, Empty, Button } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getMyProfile,
  getMemberProfile,
  getMyMonthlyBreakdown,
  getMemberMonthlyBreakdown,
  getMembers,
  type MyProfile,
  type Member,
  type MonthlyDueEntry,
  type Transaction,
  type DuesInfo,
} from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import MemberAvatar from './MemberAvatar';
import './ProfileView.css';

interface ProfileViewProps {
  variant?: 'page' | 'embedded';
}

export default function ProfileView({ variant = 'page' }: ProfileViewProps) {
  const { currencySymbol } = useSettings();
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(!isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearBreakdown, setYearBreakdown] = useState<MonthlyDueEntry[] | null>(null);
  const [yearDues, setYearDues] = useState<DuesInfo | null>(null);
  const [yearBreakdownLoading, setYearBreakdownLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      getMembers()
        .then((data) => {
          setMembers(data);
          setSelectedMemberId((current) => current ?? data[0]?.id);
        })
        .catch(() => setMembers([]));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && !selectedMemberId) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    let ignore = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = isAdmin && selectedMemberId ? await getMemberProfile(selectedMemberId) : await getMyProfile();
        if (!ignore) {
          setProfile(data);
          setSelectedYear(data.currentYear);
          setYearBreakdown(data.monthlyBreakdown);
          setYearDues(data.dues);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    load();
    return () => {
      ignore = true;
    };
  }, [isAdmin, selectedMemberId]);

  useEffect(() => {
    if (!profile || selectedYear === null) return;

    // profile.dues already IS the current year's own figure for monthly
    // plans (calculateDues/computeMonthlyBreakdownForYear reset every
    // January), so it's safe to reuse without a round-trip. Yearly plans are
    // different: profile.dues is lifetime-cumulative (same as
    // lifetimeDues), so reusing it here would show the grand total instead
    // of just this year's - those always go through the per-year API call
    // below instead, even when selectedYear is the current year.
    if (selectedYear === profile.currentYear && profile.member.payment_frequency === 'monthly') {
      setYearBreakdown(profile.monthlyBreakdown);
      setYearDues(profile.dues);
      return;
    }

    let ignore = false;
    const loadYear = async () => {
      try {
        setYearBreakdownLoading(true);
        const result =
          isAdmin && selectedMemberId
            ? await getMemberMonthlyBreakdown(selectedMemberId, selectedYear)
            : await getMyMonthlyBreakdown(selectedYear);
        if (!ignore) {
          setYearBreakdown(result.breakdown);
          setYearDues(result.dues);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load monthly breakdown');
      } finally {
        if (!ignore) setYearBreakdownLoading(false);
      }
    };
    loadYear();
    return () => {
      ignore = true;
    };
  }, [profile, selectedYear, isAdmin, selectedMemberId]);

  const transactionColumns: ColumnsType<Transaction> = [
    { title: 'Date', dataIndex: 'date', key: 'date', render: (d: string) => new Date(d).toLocaleDateString() },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={type === 'income' ? 'green' : 'red'}>{type === 'income' ? 'Income' : 'Expense'}</Tag>
      ),
    },
    { title: 'Category', dataIndex: 'category', key: 'category' },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => `${currencySymbol}${Number(amount).toFixed(2)}`,
    },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
  ];

  const monthStatusMeta: Record<MonthlyDueEntry['status'], { color: string; label: string }> = {
    paid: { color: 'green', label: 'Paid' },
    partial: { color: 'orange', label: 'Partial' },
    missed: { color: 'red', label: 'Missed' },
    nil: { color: 'default', label: 'Nil' },
  };

  const monthlyColumns: ColumnsType<MonthlyDueEntry> = [
    { title: 'Month', dataIndex: 'label', key: 'label' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: MonthlyDueEntry['status'], row: MonthlyDueEntry) => (
        <>
          <Tag color={monthStatusMeta[status].color}>{monthStatusMeta[status].label}</Tag>
          {status === 'partial' && (
            <span className="profile-view-partial-note">
              {currencySymbol}
              {Number(row.paidAmount ?? 0).toFixed(2)} of {currencySymbol}
              {Number(row.dueAmount ?? 0).toFixed(2)}
            </span>
          )}
        </>
      ),
    },
  ];

  const yearlyPaymentColumns: ColumnsType<Transaction> = [
    { title: 'Date', dataIndex: 'date', key: 'date', render: (d: string) => new Date(d).toLocaleDateString() },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => `${currencySymbol}${Number(amount).toFixed(2)}`,
    },
  ];

  const currentYear = profile?.currentYear ?? new Date().getFullYear();
  const displayYear = selectedYear ?? currentYear;
  const yearlyPayments = profile
    ? profile.transactions.filter(
        (t) =>
          t.category === 'Masjid payment' &&
          t.type === 'income' &&
          t.date.slice(0, 4) === String(displayYear)
      )
    : [];

  const containerClass = variant === 'embedded' ? 'profile-view-embedded' : 'profile-view-container';

  return (
    <div className={containerClass}>
      {variant === 'page' && isAdmin && (
        <div className="profile-view-header-row">
          <Select
            className="profile-view-selector"
            placeholder="Select a member"
            allowClear
            showSearch
            optionFilterProp="label"
            value={selectedMemberId}
            onChange={(value) => setSelectedMemberId(value)}
            options={members.map((m) => ({ value: m.id, label: `${m.name} (${m.unique_id})` }))}
          />
        </div>
      )}

      {error && <Alert message="Error" description={error} type="error" showIcon style={{ marginBottom: 16 }} />}

      {loading ? (
        <div className="profile-view-loading">
          <Spin size="large" />
        </div>
      ) : isAdmin && !selectedMemberId ? (
        <Card>
          <Empty description="Select a member above to view their profile" />
        </Card>
      ) : profile ? (
        <>
          {variant === 'page' && (
            <Card className="profile-view-card">
              <div className="profile-view-card-header">
                <MemberAvatar
                  key={profile.member.unique_id}
                  uniqueId={profile.member.unique_id}
                  size={64}
                  className={`profile-view-avatar ${profile.member.hasPushSubscription ? 'profile-view-avatar-online' : ''}`}
                />
                <div className="profile-view-card-info">
                  <div className="profile-view-header-name">{profile.member.name}</div>
                  <div className="profile-view-detail-line">
                    <span className="profile-view-detail-label">Member ID:</span> {profile.member.unique_id}
                  </div>
                  <div className="profile-view-detail-line">
                    <span className="profile-view-detail-label">Phone:</span> {profile.member.phone}
                  </div>
                  <div className="profile-view-detail-line">
                    <span className="profile-view-detail-label">Address:</span> {profile.member.address}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card className="profile-view-card" title="Payment Standing">
            {!profile.lifetimeDues.hasPlan ? (
              <Alert message="No payment plan set for this account yet." type="info" showIcon />
            ) : (
              <Row gutter={16}>
                <Col xs={24} sm={8}>
                  <Statistic
                    title="Total Expected"
                    value={profile.lifetimeDues.expected ?? 0}
                    precision={2}
                    prefix={currencySymbol}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <Statistic
                    title="Total Paid"
                    value={profile.lifetimeDues.paid}
                    precision={2}
                    prefix={currencySymbol}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <Statistic
                    title={(profile.lifetimeDues.due ?? 0) < 0 ? 'Extra Paid' : 'Pending Dues'}
                    value={Math.abs(profile.lifetimeDues.due ?? 0)}
                    precision={2}
                    prefix={currencySymbol}
                    styles={{ content: { color: (profile.lifetimeDues.due ?? 0) > 0 ? '#cf1322' : '#3f8600' } }}
                  />
                </Col>
              </Row>
            )}
          </Card>

          {profile.dues.hasPlan && profile.monthlyBreakdown ? (
            <Card
              className="profile-view-card"
              title={
                <div className="profile-view-year-selector">
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={selectedYear === null || selectedYear <= profile.joinYear}
                    onClick={() => setSelectedYear((y) => (y !== null ? y - 1 : y))}
                  />
                  <span>{selectedYear} Monthly Payment Report</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<RightOutlined />}
                    disabled={selectedYear === null || selectedYear >= profile.maxYear}
                    onClick={() => setSelectedYear((y) => (y !== null ? y + 1 : y))}
                  />
                </div>
              }
            >
              <Spin spinning={yearBreakdownLoading}>
                {(() => {
                  const yearStats = yearDues ?? profile.dues;
                  return yearStats.hasPlan ? (
                    <div className="profile-view-year-summary">
                      <span>
                        Expected: {currencySymbol}
                        {Number(yearStats.expected ?? 0).toFixed(2)}
                      </span>
                      <span>
                        Paid: {currencySymbol}
                        {Number(yearStats.paid ?? 0).toFixed(2)}
                      </span>
                      <span style={{ color: (yearStats.due ?? 0) > 0 ? '#cf1322' : '#3f8600' }}>
                        {(yearStats.due ?? 0) < 0 ? 'Extra Paid' : 'Balance'}: {currencySymbol}
                        {Number(Math.abs(yearStats.due ?? 0)).toFixed(2)}
                      </span>
                    </div>
                  ) : null;
                })()}
                <Table
                  columns={monthlyColumns}
                  dataSource={yearBreakdown ?? []}
                  rowKey={(row) => `${row.year}-${row.monthIndex}`}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
                <div className="profile-view-year-payments-heading">{displayYear} Payments</div>
                <Table
                  columns={yearlyPaymentColumns}
                  dataSource={yearlyPayments}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'No payments recorded this year' }}
                />
              </Spin>
            </Card>
          ) : profile.dues.hasPlan && profile.member.payment_frequency === 'yearly' ? (
            <Card
              className="profile-view-card"
              title={
                <div className="profile-view-year-selector">
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={selectedYear === null || selectedYear <= profile.joinYear}
                    onClick={() => setSelectedYear((y) => (y !== null ? y - 1 : y))}
                  />
                  <span>{displayYear} Payments</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<RightOutlined />}
                    disabled={selectedYear === null || selectedYear >= profile.maxYear}
                    onClick={() => setSelectedYear((y) => (y !== null ? y + 1 : y))}
                  />
                </div>
              }
            >
              <Spin spinning={yearBreakdownLoading}>
                {(() => {
                  const yearStats = yearDues ?? profile.dues;
                  if (!yearStats.hasPlan) return null;
                  const isPartial = (yearStats.paid ?? 0) > 0 && (yearStats.due ?? 0) > 0;
                  return (
                    <div className="profile-view-year-summary">
                      <span>
                        Expected: {currencySymbol}
                        {Number(yearStats.expected ?? 0).toFixed(2)}
                      </span>
                      <span>
                        Paid: {currencySymbol}
                        {Number(yearStats.paid ?? 0).toFixed(2)}
                      </span>
                      <span style={{ color: (yearStats.due ?? 0) > 0 ? '#cf1322' : '#3f8600' }}>
                        {(yearStats.due ?? 0) < 0 ? 'Extra Paid' : 'Pending'}: {currencySymbol}
                        {Number(Math.abs(yearStats.due ?? 0)).toFixed(2)}
                        {isPartial && (
                          <Tag color="orange" style={{ marginLeft: 8 }}>
                            Partial
                          </Tag>
                        )}
                      </span>
                    </div>
                  );
                })()}
                <Table
                  columns={yearlyPaymentColumns}
                  dataSource={yearlyPayments}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'No payments recorded this year' }}
                />
              </Spin>
            </Card>
          ) : (
            <Card className="profile-view-card" title="Transactions">
              <Table
                columns={transactionColumns}
                dataSource={profile.transactions}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'No transactions recorded yet' }}
              />
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
