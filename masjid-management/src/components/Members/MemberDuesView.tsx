import { useEffect, useState } from 'react';
import { Card, Table, Tag, Descriptions, Spin, Alert, Statistic, Row, Col } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getMyProfile, type MyProfile, type Transaction } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import './MemberDuesView.css';

export default function MemberDuesView() {
  const { currencySymbol } = useSettings();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getMyProfile();
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load your profile');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const columns: ColumnsType<Transaction> = [
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

  return (
    <div className="member-dues-container">
      <h1 className="member-dues-title">💳 My Dues</h1>

      {error && <Alert message="Error" description={error} type="error" showIcon style={{ marginBottom: 16 }} />}

      {loading ? (
        <div className="member-dues-loading">
          <Spin size="large" />
        </div>
      ) : profile ? (
        <>
          <Card className="member-dues-profile-card">
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label="Member ID">{profile.member.unique_id}</Descriptions.Item>
              <Descriptions.Item label="Name">{profile.member.name}</Descriptions.Item>
              <Descriptions.Item label="Address">{profile.member.address}</Descriptions.Item>
              <Descriptions.Item label="Phone">{profile.member.phone}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card className="member-dues-summary-card" title="Payment Standing">
            {!profile.dues.hasPlan ? (
              <Alert message="No payment plan set for your account yet." type="info" showIcon />
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
                    title={(profile.dues.due ?? 0) < 0 ? 'Credit Balance' : 'Amount Due'}
                    value={Math.abs(profile.dues.due ?? 0)}
                    precision={2}
                    prefix={currencySymbol}
                    valueStyle={{ color: (profile.dues.due ?? 0) < 0 ? '#3f8600' : '#cf1322' }}
                  />
                </Col>
              </Row>
            )}
          </Card>

          <Card className="member-dues-transactions-card" title="My Transactions">
            <Table
              columns={columns}
              dataSource={profile.transactions}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: 'No transactions recorded yet' }}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
