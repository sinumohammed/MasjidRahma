import { useEffect, useState } from 'react';
import { Table, Segmented, Alert, Tooltip, Checkbox, Button, Modal, Grid, message } from 'antd';
import { DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getActivityLog,
  deleteActivityEvents,
  clearActivityLog,
  type ActivityEvent,
  type ActivityEventType,
} from '../../services/api';
import MemberAvatar from '../Members/MemberAvatar';
import { announcementDate } from '../../utils/dates';
import './ActivityLog.css';

const EVENT_META: Record<ActivityEventType, { label: string; tone: string }> = {
  login: { label: 'Log in', tone: '' },
  logout: { label: 'Log out', tone: 'is-muted' },
  page_visit: { label: 'Page visit', tone: 'is-blue' },
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

  // Phones: one column - the user, with the event, time and page under it.
  const compact = !Grid.useBreakpoint().md;

  const columns: ColumnsType<ActivityEvent> = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      responsive: ['md'],
      render: (value: string) => <span className="activity-log-time">{announcementDate(value)}</span>,
    },
    {
      title: 'Event',
      dataIndex: 'event_type',
      key: 'event_type',
      width: 120,
      responsive: ['md'],
      render: (value: ActivityEventType) => <span className={`m-pill ${EVENT_META[value].tone}`}>{EVENT_META[value].label}</span>,
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
                <span className="m-pill is-gold" style={{ marginLeft: 6 }}>
                  Admin
                </span>
              )}
            </span>
          ) : (
            <span className="activity-log-guest">Guest</span>
          )}
          {compact && (
            <div className="activity-log-meta">
              <span className={`m-pill ${EVENT_META[record.event_type].tone}`}>{EVENT_META[record.event_type].label}</span>
              <span>{announcementDate(record.created_at)}</span>
              {record.path && <span>{record.path}</span>}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Page',
      dataIndex: 'path',
      key: 'path',
      responsive: ['md'],
      render: (value: string | null) => value || '—',
    },
    {
      title: 'Device',
      key: 'device',
      responsive: ['lg'],
      render: (_: unknown, record: ActivityEvent) => (
        <span>
          {[record.browser, record.os].filter(Boolean).join(' / ') || 'Unknown'}
          {record.is_pwa && (
            <Tooltip title="Opened from an installed app (PWA)">
              <span className="m-pill is-muted" style={{ marginLeft: 6 }}>
                App
              </span>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: 'Location',
      key: 'location',
      responsive: ['md'],
      render: (_: unknown, record: ActivityEvent) =>
        [record.city, record.region, record.country].filter(Boolean).join(', ') || 'Unknown',
    },
  ];

  return (
    <div className="m-page activity-log-page">
      <div className="m-page-head">
        <div className="m-page-head-text">
          <h1 className="m-page-title">Activity</h1>
          <span className="m-page-sub">Who used the app, when and from where - {total} {total === 1 ? 'event' : 'events'}</span>
        </div>
      </div>

      <div className="m-card m-toolbar activity-log-controls">
          <Checkbox
            checked={adminOnly}
            onChange={(e) => {
              setAdminOnly(e.target.checked);
              setPage(1);
            }}
          >
            Admin only
          </Checkbox>
          <Segmented
            value={eventType ?? 'all'}
            onChange={(v) => {
              setEventType(v === 'all' ? undefined : (v as ActivityEventType));
              setPage(1);
            }}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Log in', value: 'login' },
              { label: 'Log out', value: 'logout' },
              { label: 'Page visits', value: 'page_visit' },
            ]}
            className="activity-log-filter"
          />
          <span className="activity-log-spacer" />
          {selectedIds.length > 0 && (
            <Button danger icon={<DeleteOutlined />} loading={deleting} onClick={handleDeleteSelected}>
              Delete ({selectedIds.length})
            </Button>
          )}
          <Button danger type="text" icon={<ClearOutlined />} loading={deleting} onClick={handleClearAll}>
            Clear all
          </Button>
      </div>

      {error && (
        <Alert message="Could not load the activity" description={error} type="error" showIcon />
      )}

      <div className="m-card m-table-card">
      <Table
        columns={columns}
        dataSource={events}
        rowKey="id"
        rowSelection={
          compact
            ? undefined
            : {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as string[]),
              }
        }
        loading={loading}
        className="activity-log-table"
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />
      </div>
    </div>
  );
}
