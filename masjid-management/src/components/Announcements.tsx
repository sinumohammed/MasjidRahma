import { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Input, Form, Alert, Tooltip, Popconfirm, Empty, Spin, message } from 'antd';
import { SoundOutlined, BellOutlined, NotificationOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getPendingDuesMembers,
  remindMember,
  remindAllPending,
  sendAnnouncement,
  type PendingDuesMember,
} from '../services/api';
import { useSettings } from '../context/SettingsContext';
import './Announcements.css';

const { TextArea } = Input;

export default function Announcements() {
  const { currencySymbol } = useSettings();
  const [pending, setPending] = useState<PendingDuesMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindingAll, setRemindingAll] = useState(false);

  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMessage, setAnnounceMessage] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);

  const loadPending = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPendingDuesMembers();
      setPending(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  const handleRemind = async (member: PendingDuesMember) => {
    setRemindingId(member.id);
    try {
      const result = await remindMember(member.id);
      if (result.sent > 0) {
        message.success(`Reminder sent to ${member.name}`);
      } else {
        message.warning(result.reason || `Could not send a reminder to ${member.name}`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send reminder');
    } finally {
      setRemindingId(null);
    }
  };

  const handleRemindAll = async () => {
    setRemindingAll(true);
    try {
      const result = await remindAllPending();
      message.success(`Reminded ${result.remindersSent} of ${result.checked} pending member(s)`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setRemindingAll(false);
    }
  };

  const handleSendAnnouncement = async () => {
    if (!announceTitle.trim() || !announceMessage.trim()) {
      message.error('Please enter both a title and a message');
      return;
    }
    setSendingAnnouncement(true);
    try {
      const result = await sendAnnouncement(announceTitle.trim(), announceMessage.trim());
      if (result.sent > 0) {
        message.success(`Announcement sent to ${result.sent} device(s)`);
        setAnnounceTitle('');
        setAnnounceMessage('');
      } else {
        message.warning(result.reason || 'No devices received the announcement');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send announcement');
    } finally {
      setSendingAnnouncement(false);
    }
  };

  const columns: ColumnsType<PendingDuesMember> = [
    {
      title: 'Member',
      key: 'member',
      render: (_, member) => (
        <div>
          <div className="announcements-member-name">{member.name}</div>
          <div className="announcements-member-id">{member.unique_id}</div>
        </div>
      ),
    },
    {
      title: 'Plan',
      dataIndex: 'payment_frequency',
      key: 'payment_frequency',
      render: (freq: PendingDuesMember['payment_frequency']) => (
        <Tag color={freq === 'monthly' ? 'blue' : 'purple'}>{freq === 'monthly' ? 'Monthly' : 'Yearly'}</Tag>
      ),
    },
    {
      title: 'Due',
      dataIndex: 'due',
      key: 'due',
      render: (due: number) => (
        <span className="announcements-due-amount">
          {currencySymbol}
          {due.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Missed Months',
      dataIndex: 'missedMonths',
      key: 'missedMonths',
      render: (missedMonths: string[] | null) =>
        missedMonths && missedMonths.length > 0 ? missedMonths.join(', ') : '-',
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      align: 'center',
      fixed: 'right',
      render: (_, member) => (
        <Tooltip title={member.hasPushSubscription ? 'Send reminder' : 'Member has not enabled notifications'}>
          <Popconfirm
            title={`Send a payment reminder to ${member.name}?`}
            onConfirm={() => handleRemind(member)}
            disabled={!member.hasPushSubscription}
          >
            <Button
              icon={<BellOutlined />}
              shape="circle"
              size="small"
              loading={remindingId === member.id}
              disabled={!member.hasPushSubscription}
            />
          </Popconfirm>
        </Tooltip>
      ),
    },
  ];

  return (
    <div className="announcements-container">
      <div className="announcements-header">
        <h1 className="announcements-title">
          <SoundOutlined /> Announcements
        </h1>
      </div>

      <Card className="announcements-card" title={<><NotificationOutlined /> Public Announcement</>}>
        <Form layout="vertical">
          <Form.Item label="Title">
            <Input
              placeholder="e.g. Friday Jumu'ah time change"
              value={announceTitle}
              onChange={(e) => setAnnounceTitle(e.target.value)}
              maxLength={100}
            />
          </Form.Item>
          <Form.Item label="Message">
            <TextArea
              placeholder="Write the announcement for all members..."
              value={announceMessage}
              onChange={(e) => setAnnounceMessage(e.target.value)}
              rows={3}
              maxLength={500}
              showCount
            />
          </Form.Item>
          <Popconfirm
            title="Send this announcement to all members?"
            description="Every member with notifications enabled will receive it."
            onConfirm={handleSendAnnouncement}
            disabled={!announceTitle.trim() || !announceMessage.trim()}
          >
            <Button
              type="primary"
              icon={<SoundOutlined />}
              loading={sendingAnnouncement}
              disabled={!announceTitle.trim() || !announceMessage.trim()}
            >
              Send to All Members
            </Button>
          </Popconfirm>
        </Form>
      </Card>

      <Card
        className="announcements-card"
        title={<><BellOutlined /> Pending Masjid Payments</>}
        extra={
          pending.length > 0 && (
            <Popconfirm
              title="Send a reminder to every pending member?"
              onConfirm={handleRemindAll}
            >
              <Button icon={<BellOutlined />} loading={remindingAll}>
                Remind All ({pending.length})
              </Button>
            </Popconfirm>
          )
        }
      >
        {error && <Alert message="Error" description={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        {loading ? (
          <div className="announcements-loading">
            <Spin size="large" />
          </div>
        ) : pending.length === 0 ? (
          <Empty description="No members currently have a pending Masjid payment" />
        ) : (
          <Table
            columns={columns}
            dataSource={pending}
            rowKey="id"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Card>
    </div>
  );
}
