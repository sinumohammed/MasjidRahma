import { useEffect, useState } from 'react';
import { Card, Alert, Spin, Empty, List } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { getMyNotifications, type MemberNotification } from '../services/api';
import './Announcements.css';

export default function MyNotifications() {
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="announcements-container">
      <div className="announcements-header">
        <h1 className="announcements-title">
          <BellOutlined /> My Notifications
        </h1>
      </div>

      <Card className="announcements-card">
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
              <List.Item key={item.id} className="announcement-list-item">
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
