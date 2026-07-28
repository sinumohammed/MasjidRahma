import { useEffect, useState } from 'react';
import { Table, Tag, Select, Alert, Tooltip, Checkbox, Button, Modal, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getActivityLog,
  deleteActivityEvents,
  clearActivityLog,
  type ActivityEvent,
  type ActivityEventType,
} from '../../services/api';
import MemberAvatar from '../Members/MemberAvatar';
import './ActivityLog.css';

const EVENT_META: Record<ActivityEventType, { label: string; color: string }> = {
  login: { label: 'Login', color: 'green' },
  logout: { label: 'Logout', color: 'default' },
  page_visit: { label: 'Page Visit', color: 'blue' },
};

// Matches App.tsx's ADMIN_AVATAR_ID - the admin account has no member row of
// its own, so its avatar is looked up via the same fixed asset name.
const ADMIN_AVATAR_ID = 'masjidrahma';

const PAGE_SIZE = 50;

export default function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState<ActivityEventType | undefined>(undefined);
  const [adminOnly, setAdminOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    getActivityLog({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, eventType, isAdmin: adminOnly })
      .then(({ events: data, total: count }) => {
        if (ignore) return;
        setEvents(data);
        setTotal(count);
        setSelectedIds([]);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load activity log');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [page, eventType, adminOnly, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  const handleDeleteSelected = () => {
    Modal.confirm({
      title: `Delete ${selectedIds.length} selected event${selectedIds.length === 1 ? '' : 's'}?`,
      content: 'This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setDeleting(true);
          await deleteActivityEvents(selectedIds);
          reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Failed to delete selected events');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const handleClearAll = () => {
    Modal.confirm({
      title: 'Clear the entire activity log?',
      content: 'This permanently deletes every recorded event, not just the current page. This cannot be undone.',
      okText: 'Clear All',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setDeleting(true);
          await clearActivityLog();
          setPage(1);
          reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Failed to clear activity log');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const columns: ColumnsType<ActivityEvent> = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: 'Event',
      dataIndex: 'event_type',
      key: 'event_type',
      width: 120,
      render: (value: ActivityEventType) => <Tag color={EVENT_META[value].color}>{EVENT_META[value].label}</Tag>,
    },
    {
      title: 'User',
      key: 'user',
      render: (_: unknown, record: ActivityEvent) => (
        <div className="activity-log-user-cell">
          <MemberAvatar
            key={record.is_admin ? ADMIN_AVATAR_ID : record.username || 'guest'}
            uniqueId={record.is_admin ? ADMIN_AVATAR_ID : record.username}
            size={28}
            className="activity-log-avatar"
          />
          {record.username ? (
            <span>
              {record.username}
              {record.is_admin && (
                <Tag color="gold" style={{ marginLeft: 6 }}>
                  Admin
                </Tag>
              )}
            </span>
          ) : (
            <span className="activity-log-guest">Guest</span>
          )}
        </div>
      ),
    },
    {
      title: 'Page',
      dataIndex: 'path',
      key: 'path',
      render: (value: string | null) => value || '—',
    },
    {
      title: 'Device',
      key: 'device',
      render: (_: unknown, record: ActivityEvent) => (
        <span>
          {[record.browser, record.os].filter(Boolean).join(' / ') || 'Unknown'}
          {record.is_pwa && (
            <Tooltip title="Opened from an installed app (PWA)">
              <Tag color="purple" style={{ marginLeft: 6 }}>
                PWA
              </Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: unknown, record: ActivityEvent) =>
        [record.city, record.region, record.country].filter(Boolean).join(', ') || 'Unknown',
    },
  ];

  return (
    <div className="activity-log-container">
      <div className="activity-log-header">
        <h1 className="activity-log-title">🕒 Activity</h1>
        <div className="activity-log-controls">
          <Checkbox
            checked={adminOnly}
            onChange={(e) => {
              setAdminOnly(e.target.checked);
              setPage(1);
            }}
          >
            Admin only
          </Checkbox>
          <Select
            placeholder="All events"
            value={eventType}
            onChange={(value) => {
              setEventType(value);
              setPage(1);
            }}
            allowClear
            className="activity-log-filter"
            options={[
              { label: 'Login', value: 'login' },
              { label: 'Logout', value: 'logout' },
              { label: 'Page Visit', value: 'page_visit' },
            ]}
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selectedIds.length === 0}
            loading={deleting}
            onClick={handleDeleteSelected}
          >
            Delete Selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
          </Button>
          <Button danger icon={<DeleteOutlined />} loading={deleting} onClick={handleClearAll}>
            Clear All
          </Button>
        </div>
      </div>

      {error && (
        <Alert message="Error Loading Activity" description={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      <Table
        columns={columns}
        dataSource={events}
        rowKey="id"
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        loading={loading}
        className="activity-log-table"
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />
    </div>
  );
}
