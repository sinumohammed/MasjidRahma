import { useEffect, useState } from 'react';
import { Card, Table, Tag, Descriptions, Spin, Alert, Statistic, Row, Col, Select, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  getMyProfile,
  getMemberProfile,
  getMembers,
  type MyProfile,
  type Member,
  type MonthlyDueEntry,
  type Transaction,
} from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
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

  useEffect(() => {
    if (isAdmin) {
      getMembers()
        .then(setMembers)
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
        if (!ignore) setProfile(data);
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
    missed: { color: 'red', label: 'Missed' },
    nil: { color: 'default', label: 'Nil' },
  };

  const monthlyColumns: ColumnsType<MonthlyDueEntry> = [
    { title: 'Month', dataIndex: 'label', key: 'label' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: MonthlyDueEntry['status']) => (
        <Tag color={monthStatusMeta[status].color}>{monthStatusMeta[status].label}</Tag>
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
  const yearlyPayments = profile
    ? profile.transactions.filter(
        (t) =>
          t.category === 'Masjid payment' &&
          t.type === 'income' &&
          t.date.slice(0, 4) === String(currentYear)
      )
    : [];

  const containerClass = variant === 'embedded' ? 'profile-view-embedded' : 'profile-view-container';

  return (
    <div className={containerClass}>
      {variant === 'page' && <h1 className="profile-view-title">👤 Profile</h1>}

      {isAdmin && (
        <Card className="profile-view-selector-card">
          <span className="profile-view-selector-label">View member profile:</span>
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
        </Card>
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
              <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="Member ID">{profile.member.unique_id}</Descriptions.Item>
                <Descriptions.Item label="Name">{profile.member.name}</Descriptions.Item>
                <Descriptions.Item label="Address">{profile.member.address}</Descriptions.Item>
                <Descriptions.Item label="Phone">{profile.member.phone}</Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          <Card className="profile-view-card" title="Payment Standing">
            {!profile.dues.hasPlan ? (
              <Alert message="No payment plan set for this account yet." type="info" showIcon />
            ) : (
              <Row gutter={16}>
                <Col xs={24} sm={8}>
                  <Statistic
                    title="Expected So Far"
                    value={profile.dues.expected ?? 0}
                    precision={2}
                    prefix={currencySymbol}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <Statistic title="Total Paid" value={profile.dues.paid} precision={2} prefix={currencySymbol} />
                </Col>
                <Col xs={24} sm={8}>
                  <Statistic
                    title="Credit Balance"
                    value={-(profile.dues.due ?? 0)}
                    precision={2}
                    prefix={currencySymbol}
                    valueStyle={{ color: -(profile.dues.due ?? 0) < 0 ? '#cf1322' : '#3f8600' }}
                  />
                </Col>
              </Row>
            )}
          </Card>

          {profile.dues.hasPlan && profile.monthlyBreakdown ? (
            <Card className="profile-view-card" title={`${currentYear} Monthly Payment Report`}>
              <Table
                columns={monthlyColumns}
                dataSource={profile.monthlyBreakdown}
                rowKey={(row) => `${row.year}-${row.monthIndex}`}
                pagination={false}
                scroll={{ x: 'max-content' }}
              />
            </Card>
          ) : profile.dues.hasPlan && profile.member.payment_frequency === 'yearly' ? (
            <Card className="profile-view-card" title={`${currentYear} Payments`}>
              <Table
                columns={yearlyPaymentColumns}
                dataSource={yearlyPayments}
                rowKey="id"
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'No payments recorded this year' }}
              />
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
