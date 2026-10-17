import { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import BrandMark from './BrandMark';
import './InlineLoginForm.css';

// `onDone`: after a successful log-in (the pop-up closes itself).
export default function InlineLoginForm({ onDone }: { onDone?: () => void }) {
  const { hasAdmin, login, setupAccount } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isSetupMode = hasAdmin === false;

  const handleSubmit = async (values: { username: string; password: string }) => {
    try {
      setLoading(true);
      if (isSetupMode) {
        await setupAccount(values.username, values.password);
        message.success('Admin account created');
      } else {
        await login(values.username, values.password);
        message.success('Logged in');
      }
      form.resetFields();
      onDone?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-login-card">
      <div className="inline-login-header">
        <BrandMark size={44} />
        <div>
          <h2>{isSetupMode ? 'Create the admin account' : 'Welcome back'}</h2>
          <p>{isSetupMode ? 'The first account manages the masjid.' : 'Log in to see your dues, payments and duty days.'}</p>
        </div>
      </div>
      <Form form={form} layout="vertical" onFinish={handleSubmit} className="inline-login-form" requiredMark={false}>
        <Form.Item
          label={isSetupMode ? 'Username' : 'Member ID or username'}
          name="username"
          rules={[{ required: true, message: 'Please enter a username' }]}
        >
          <Input prefix={<UserOutlined />} placeholder={isSetupMode ? "Username" : "e.g. MR#012"} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item
          label="Password"
          name="password"
          rules={[
            { required: true, message: 'Please enter a password' },
            ...(isSetupMode ? [{ min: 6, message: 'Password must be at least 6 characters' }] : []),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Password" autoComplete="current-password" />
        </Form.Item>
        {isSetupMode && (
          <Form.Item
            label="Confirm Password"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Please confirm your password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Confirm password" />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            {isSetupMode ? 'Create Account' : 'Log In'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
