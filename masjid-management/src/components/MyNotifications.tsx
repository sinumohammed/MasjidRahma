import { useEffect, useState } from 'react';
import { Card, Alert, Spin, Empty, List, Button, Popconfirm, message } from 'antd';
import { BellOutlined, DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import {
  getMyNotifications,
  deleteMyNotification,
  clearMyNotifications,
  type MemberNotification,
} from '../services/api';
import './Announcements.css';

export default function MyNotifications() {
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getMyNotifications();
        setNotifications(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notifications');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMyNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to delete notification');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      await clearMyNotifications();
      setNotifications([]);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to clear notifications');
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="announcements-container">
      <div className="announcements-header">
        <h1 className="announcements-title">
          <BellOutlined /> My Notifications
        </h1>
      </div>

      <Card
        className="announcements-card"
        extra={
          notifications.length > 0 && (
            <Popconfirm
              title="Clear all your notifications?"
              description="This removes your entire notification history."
              onConfirm={handleClearAll}
            >
              <Button icon={<ClearOutlined />} loading={clearingAll} danger>
                Clear All
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
        ) : notifications.length === 0 ? (
          <Empty description="No notifications yet" />
        ) : (
          <List
            itemLayout="vertical"
            dataSource={notifications}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                className="announcement-list-item"
                actions={[
                  <Popconfirm
                    key="delete"
                    title="Delete this notification?"
                    onConfirm={() => handleDelete(item.id)}
                  >
                    <Button icon={<DeleteOutlined />} size="small" danger loading={deletingId === item.id}>
                      Delete
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <div className="announcement-item-title">{item.title}</div>
                <div className="announcement-item-message">{item.message}</div>
                <div className="announcement-item-date">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
