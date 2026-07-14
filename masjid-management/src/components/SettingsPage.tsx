import { useState } from 'react';
import { Card, Switch, Select, Button, InputNumber, message, Space, Divider, Alert, Form, Input, Collapse } from 'antd';
import {
  BulbOutlined,
  DownloadOutlined,
  DatabaseOutlined,
  MoonOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { getTransactions, seedTransactions, changePassword } from '../services/api';
import { useSettings, CURRENCY_SYMBOLS, type CurrencyCode } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
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
  const { isAdmin } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [seedCount, setSeedCount] = useState<number>(50);
  const [seeding, setSeeding] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm] = Form.useForm();

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

  const handleSeed = async () => {
    try {
      setSeeding(true);
      const result = await seedTransactions(seedCount);
      message.success(result.message);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to generate test data');
    } finally {
      setSeeding(false);
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
      </Card>

      {isAdmin && (
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

      <Card title={<span><DownloadOutlined /> Export Data</span>} className="settings-card" bordered={false}>
        {isAdmin ? (
          <>
            <p className="settings-row-hint">Download all transactions for backup or use in other tools.</p>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={() => handleExport('csv')} loading={exporting}>
                Export as CSV
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => handleExport('json')} loading={exporting}>
                Export as JSON
              </Button>
            </Space>
          </>
        ) : (
          <Alert message="Log in as admin to use this feature" type="info" showIcon />
        )}
      </Card>

      <Card title={<span><DatabaseOutlined /> Test Data Generator</span>} className="settings-card" bordered={false}>
        {isAdmin ? (
          <>
            <p className="settings-row-hint">
              Populate the database with realistic sample income and expense transactions for testing.
            </p>
            <Space wrap>
              <InputNumber min={1} max={500} value={seedCount} onChange={(v) => setSeedCount(v || 1)} />
              <Button type="primary" icon={<DatabaseOutlined />} onClick={handleSeed} loading={seeding}>
                Generate Test Data
              </Button>
            </Space>
          </>
        ) : (
          <Alert message="Log in as admin to use this feature" type="info" showIcon />
        )}
      </Card>
    </div>
  );
}
