import { useEffect, useState } from 'react';
import { Card, Switch, Select, Button, message, Space, Divider, Form, Input, Collapse, Row, Col, Modal } from 'antd';
import {
  BulbOutlined,
  DownloadOutlined,
  MoonOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  PhoneOutlined,
  BellOutlined,
  EditOutlined,
} from '@ant-design/icons';
import {
  getTransactions,
  changePassword,
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  getContacts,
  updateContact,
  type Contact,
} from '../services/api';
import { useSettings, CURRENCY_SYMBOLS, type CurrencyCode } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { urlBase64ToUint8Array } from '../utils/push';
import './SettingsPage.css';

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface ContactRowProps {
  contact: Contact;
  editable: boolean;
  onEdit: (contact: Contact) => void;
}

function ContactRow({ contact, editable, onEdit }: ContactRowProps) {
  return (
    <div className="settings-contact-row">
      <span className="settings-contact-name">{contact.name}</span>
      <span className="settings-contact-row-right">
        {contact.phone ? (
          <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="settings-contact-phone">
            <PhoneOutlined /> {contact.phone}
          </a>
        ) : (
          <span className="settings-contact-phone settings-contact-nil">Nil</span>
        )}
        {editable && (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEdit(contact)}
            className="settings-contact-edit-btn"
          />
        )}
      </span>
    </div>
  );
}

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    let str = String(val ?? '');
    // Neutralize formula injection in spreadsheet apps (Excel/Sheets execute
    // cells starting with =, +, -, or @ as formulas when the CSV is opened).
    if (/^[=+\-@]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

export default function SettingsPage() {
  const { theme, setTheme, currency, setCurrency } = useSettings();
  const { isAdmin, isLoggedIn } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm] = Form.useForm();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [contactForm] = Form.useForm();

  useEffect(() => {
    getContacts()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  const openEditContact = (contact: Contact) => {
    setEditingContact(contact);
    contactForm.setFieldsValue({ name: contact.name, phone: contact.phone || '' });
  };

  const handleSaveContact = async (values: { name: string; phone: string }) => {
    if (!editingContact) return;
    setSavingContact(true);
    try {
      const updated = await updateContact(editingContact.id, values.name, values.phone || null);
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      message.success('Contact updated');
      setEditingContact(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update contact');
    } finally {
      setSavingContact(false);
    }
  };

  const committeeContacts = contacts.filter((c) => c.group_key === 'committee');
  const muaddinContacts = contacts.filter((c) => c.group_key === 'muaddin');
  const queryContacts = contacts.filter((c) => c.group_key === 'query');

  const showNotificationsCard = isLoggedIn && !isAdmin;
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);

  // Shared by the manual toggle and the auto-opt-in effect below - requests
  // permission, subscribes, and registers the subscription with the server.
  const enablePushSubscription = async (publicKey: string): Promise<boolean> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') return false;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await subscribePush(subscription.toJSON() as PushSubscriptionJSON);
      setPushSubscribed(true);
      return true;
    } catch (err) {
      console.warn('Failed to enable push notifications:', err);
      return false;
    }
  };

  useEffect(() => {
    if (!showNotificationsCard) return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    setPushSupported(supported);
    if (!supported) return;

    let cancelled = false;

    (async () => {
      setNotificationPermission(Notification.permission);

      let publicKey: string | null = null;
      try {
        publicKey = await getVapidPublicKey();
        if (!cancelled) setVapidPublicKey(publicKey);
      } catch {
        // Leave vapidPublicKey null - the card hides itself in that case.
      }

      let existingSub: PushSubscription | null = null;
      try {
        const registration = await navigator.serviceWorker.ready;
        existingSub = await registration.pushManager.getSubscription();
        if (!cancelled) setPushSubscribed(!!existingSub);
      } catch {
        // Non-critical - toggle just starts in the "off" state.
      }

      // Members default to notifications enabled: auto opt-in on first
      // visit rather than waiting for them to flip the switch themselves.
      // Safe to attempt on every visit without spamming - once permission
      // is denied it's sticky, so requestPermission() silently returns
      // 'denied' again with no prompt on subsequent loads.
      if (!cancelled && !existingSub && publicKey && Notification.permission !== 'denied') {
        await enablePushSubscription(publicKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showNotificationsCard]);

  const handleTogglePush = async (checked: boolean) => {
    setPushBusy(true);
    try {
      if (checked) {
        if (!vapidPublicKey) {
          message.error('Push notifications are not configured on the server');
          return;
        }
        const enabled = await enablePushSubscription(vapidPublicKey);
        if (enabled) {
          message.success('Food-day reminders enabled');
        } else if (Notification.permission !== 'granted') {
          message.error('Notification permission was not granted');
        } else {
          message.error('Failed to enable reminders');
        }
      } else {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          await unsubscribePush(subscription.endpoint);
        }
        setPushSubscribed(false);
        message.success('Food-day reminders disabled');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update reminder settings');
    } finally {
      setPushBusy(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      setExporting(true);
      const transactions = await getTransactions();
      const timestamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        downloadFile(
          `masjid-transactions-${timestamp}.json`,
          JSON.stringify(transactions, null, 2),
          'application/json'
        );
      } else {
        downloadFile(
          `masjid-transactions-${timestamp}.csv`,
          toCsv(transactions as unknown as Record<string, unknown>[]),
          'text/csv'
        );
      }
      message.success(`Exported ${transactions.length} transactions as ${format.toUpperCase()}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleChangePassword = async (values: { currentPassword: string; newPassword: string }) => {
    try {
      setChangingPassword(true);
      await changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed successfully');
      passwordForm.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="settings-container">
      <h1 className="settings-title">⚙️ Settings</h1>

      <Card title={<span><BulbOutlined /> Appearance</span>} className="settings-card" bordered={false}>
        <div className="settings-row">
          <div>
            <div className="settings-row-label"><MoonOutlined /> Dark Mode</div>
            <div className="settings-row-hint">Switch between light and dark theme</div>
          </div>
          <Switch
            checked={theme === 'dark'}
            onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          />
        </div>

        {isAdmin && (
          <>
            <Divider />

            <div className="settings-row">
              <div>
                <div className="settings-row-label">Currency</div>
                <div className="settings-row-hint">Used for all amounts across the app</div>
              </div>
              <Select
                value={currency}
                onChange={(value: CurrencyCode) => setCurrency(value)}
                style={{ width: 160 }}
                options={Object.entries(CURRENCY_SYMBOLS).map(([code, symbol]) => ({
                  label: `${symbol} ${code}`,
                  value: code,
                }))}
              />
            </div>
          </>
        )}
      </Card>

      {showNotificationsCard && pushSupported && vapidPublicKey && (
        <Card title={<span><BellOutlined /> Notifications</span>} className="settings-card" bordered={false}>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Food-day reminders</div>
              <div className="settings-row-hint">Get a push notification the day before your food-day turn.</div>
              {notificationPermission === 'denied' && (
                <div className="settings-row-hint" style={{ color: '#cf1322' }}>
                  Notifications are blocked for this site in your browser settings — enable them there first.
                </div>
              )}
            </div>
            <Switch
              checked={pushSubscribed}
              loading={pushBusy}
              disabled={notificationPermission === 'denied'}
              onChange={handleTogglePush}
            />
          </div>
        </Card>
      )}

      {isLoggedIn && (
        <Collapse
          className="settings-card"
          bordered={false}
          items={[
            {
              key: 'change-password',
              label: <span><LockOutlined /> Change Password</span>,
              children: (
                <Form
                  form={passwordForm}
                  layout="vertical"
                  onFinish={handleChangePassword}
                  style={{ maxWidth: 360 }}
                >
                  {!isAdmin && (
                    <p className="settings-row-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                      If you haven't changed your password before, your current password is your phone number.
                    </p>
                  )}
                  <Form.Item
                    label="Current Password"
                    name="currentPassword"
                    rules={[{ required: true, message: 'Please enter your current password' }]}
                  >
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  <Form.Item
                    label="New Password"
                    name="newPassword"
                    rules={[
                      { required: true, message: 'Please enter a new password' },
                      { min: 6, message: 'Password must be at least 6 characters' },
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item
                    label="Confirm New Password"
                    name="confirmPassword"
                    dependencies={['newPassword']}
                    rules={[
                      { required: true, message: 'Please confirm your new password' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value || getFieldValue('newPassword') === value) {
                            return Promise.resolve();
                          }
                          return Promise.reject(new Error('Passwords do not match'));
                        },
                      }),
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" loading={changingPassword}>
                      Update Password
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      )}

      {isAdmin && (
        <Card title={<span><DownloadOutlined /> Export Data</span>} className="settings-card" bordered={false}>
          <p className="settings-row-hint">Download all transactions for backup or use in other tools.</p>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => handleExport('csv')} loading={exporting}>
              Export as CSV
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => handleExport('json')} loading={exporting}>
              Export as JSON
            </Button>
          </Space>
        </Card>
      )}

      <Card title={<span><QuestionCircleOutlined /> Help</span>} className="settings-card" bordered={false}>
        <Row gutter={[24, 16]}>
          <Col xs={24} sm={12}>
            <div className="settings-row-label">Masjid Committee</div>
            {committeeContacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} editable={isAdmin} onEdit={openEditContact} />
            ))}
          </Col>
          <Col xs={24} sm={12}>
            <div className="settings-row-label">Muaddin</div>
            {muaddinContacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} editable={isAdmin} onEdit={openEditContact} />
            ))}
          </Col>
        </Row>

        <Divider />

        <div className="settings-row-label">Site Related Queries</div>
        {queryContacts.map((contact) => (
          <ContactRow key={contact.id} contact={contact} editable={isAdmin} onEdit={openEditContact} />
        ))}
      </Card>

      <Modal
        title="Edit Contact"
        open={!!editingContact}
        onCancel={() => setEditingContact(null)}
        onOk={() => contactForm.submit()}
        confirmLoading={savingContact}
        okText="Save"
      >
        <Form form={contactForm} layout="vertical" onFinish={handleSaveContact}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Phone" name="phone">
            <Input placeholder="Leave blank for Nil" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
