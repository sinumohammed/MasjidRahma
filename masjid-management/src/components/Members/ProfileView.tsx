import { useEffect, useState } from 'react';
import { Card, Table, Spin, Alert, Select, Empty, Button } from 'antd';
import { LeftOutlined, RightOutlined, PhoneOutlined, EnvironmentOutlined, IdcardOutlined, ArrowUpOutlined, ArrowDownOutlined, FileDoneOutlined } from '@ant-design/icons';
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
import { money } from '../../utils/money';
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
      // A yearly member's per-year request may still have been running when
      // the admin switched to this member; its cleanup skips the finally
      // block, so clear the spinner here or it never stops.
      setYearBreakdownLoading(false);
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
        <span className={`m-pill ${type === 'income' ? '' : 'is-rose'}`}>{type === 'income' ? 'Income' : 'Expense'}</span>
      ),
    },
    { title: 'Category', dataIndex: 'category', key: 'category' },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => `${currencySymbol}${money(amount)}`,
    },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
  ];

  const monthStatusMeta: Record<MonthlyDueEntry['status'], { tone: string; label: string }> = {
    paid: { tone: '', label: 'Paid' },
    partial: { tone: 'is-gold', label: 'Partial' },
    missed: { tone: 'is-rose', label: 'Missed' },
    nil: { tone: 'is-muted', label: 'Nil' },
  };

  const monthlyColumns: ColumnsType<MonthlyDueEntry> = [
    { title: 'Month', dataIndex: 'label', key: 'label' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: MonthlyDueEntry['status'], row: MonthlyDueEntry) => (
        <>
          <span className={`m-pill ${monthStatusMeta[status].tone}`}>{monthStatusMeta[status].label}</span>
          {status === 'partial' && (
            <span className="profile-view-partial-note">
              {currencySymbol}
              {money(row.paidAmount ?? 0)} of {currencySymbol}
              {money(row.dueAmount ?? 0)}
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
      render: (amount: number) => `${currencySymbol}${money(amount)}`,
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

  const containerClass = variant === 'embedded' ? 'm-page profile-view-embedded' : 'm-page profile-view-container';

  return (
    <div className={containerClass}>
      {variant === 'page' && (
        <div className="m-page-head">
          <div className="m-page-head-text">
            <h1 className="m-page-title">Profile</h1>
            <span className="m-page-sub">{isAdmin ? "A member's dues, payments and details" : 'Your dues, payments and details'}</span>
          </div>
          {isAdmin && (
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
          )}
        </div>
      )}

      {error && <Alert message="Error" description={error} type="error" showIcon style={{ marginBottom: 16 }} />}

      {loading ? (
        <div className="profile-view-loading">
          <Spin size="large" />
        </div>
      ) : isAdmin && !selectedMemberId ? (
        <Card className="m-card">
          <Empty description="Pick a member above to see their profile" />
        </Card>
      ) : profile ? (
        <>
          {variant === 'page' && (
            <div className="m-card profile-view-hero">
              <MemberAvatar
                key={profile.member.unique_id}
                uniqueId={profile.member.unique_id}
                size={76}
                className={`profile-view-avatar ${profile.member.hasPushSubscription ? 'profile-view-avatar-online' : ''}`}
              />
              <div className="profile-view-card-info">
                <div className="profile-view-header-name">{profile.member.name}</div>
                <div className="profile-view-chips">
                  <span>
                    <IdcardOutlined /> {profile.member.unique_id}
                  </span>
                  {profile.member.phone && (
                    <a href={`tel:${profile.member.phone.replace(/\s+/g, '')}`}>
                      <PhoneOutlined /> {profile.member.phone}
                    </a>
                  )}
                  {profile.member.address && (
                    <span>
                      <EnvironmentOutlined /> {profile.member.address}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {!profile.lifetimeDues.hasPlan ? (
            <Alert message="No payment plan set for this account yet." type="info" showIcon />
          ) : (
            <div className="stat-tile-row profile-view-standing">
              <div className="stat-tile masjid-tile">
                <div className="stat-tile-icon">
                  <FileDoneOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Total expected</span>
                  <span className="stat-tile-value">
                    {currencySymbol}
                    {money(profile.lifetimeDues.expected ?? 0)}
                  </span>
                </div>
              </div>
              <div className="stat-tile income-tile">
                <div className="stat-tile-icon">
                  <ArrowUpOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">Total paid</span>
                  <span className="stat-tile-value">
                    {currencySymbol}
                    {money(profile.lifetimeDues.paid)}
                  </span>
                </div>
              </div>
              <div className={`stat-tile ${(profile.lifetimeDues.due ?? 0) > 0 ? 'expense-tile' : 'income-tile'}`}>
                <div className="stat-tile-icon">
                  <ArrowDownOutlined />
                </div>
                <div className="stat-tile-body">
                  <span className="stat-tile-label">{(profile.lifetimeDues.due ?? 0) < 0 ? 'Extra paid' : 'Pending dues'}</span>
                  <span className="stat-tile-value" style={{ color: (profile.lifetimeDues.due ?? 0) > 0 ? 'var(--m-rose)' : undefined }}>
                    {currencySymbol}
                    {money(Math.abs(profile.lifetimeDues.due ?? 0))}
                  </span>
                </div>
              </div>
            </div>
          )}

          {profile.dues.hasPlan && profile.monthlyBreakdown ? (
            <Card
              className="m-card profile-view-card"
              title={
                <div className="profile-view-year-selector">
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={selectedYear === null || selectedYear <= profile.joinYear}
                    onClick={() => setSelectedYear((y) => (y !== null ? y - 1 : y))}
                  />
                  <span>{selectedYear} monthly payments</span>
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
                        {money(yearStats.expected ?? 0)}
                      </span>
                      <span>
                        Paid: {currencySymbol}
                        {money(yearStats.paid ?? 0)}
                      </span>
                      <span style={{ color: (yearStats.due ?? 0) > 0 ? 'var(--m-rose)' : 'var(--m-primary)' }}>
                        {(yearStats.due ?? 0) < 0 ? 'Extra Paid' : 'Balance'}: {currencySymbol}
                        {money(Math.abs(yearStats.due ?? 0))}
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
              className="m-card profile-view-card"
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
                        {money(yearStats.expected ?? 0)}
                      </span>
                      <span>
                        Paid: {currencySymbol}
                        {money(yearStats.paid ?? 0)}
                      </span>
                      <span style={{ color: (yearStats.due ?? 0) > 0 ? 'var(--m-rose)' : 'var(--m-primary)' }}>
                        {(yearStats.due ?? 0) < 0 ? 'Extra Paid' : 'Pending'}: {currencySymbol}
                        {money(Math.abs(yearStats.due ?? 0))}
                        {isPartial && (
                          <span className="m-pill is-gold" style={{ marginLeft: 8 }}>
                            Partial
                          </span>
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
            <Card className="m-card profile-view-card" title="Transactions">
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
