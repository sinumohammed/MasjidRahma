import { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import './InlineLoginForm.css';

export default function InlineLoginForm() {
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-login-card">
      <div className="inline-login-header">
        <LockOutlined />
        <span>{isSetupMode ? 'Create Admin Account' : 'Log In'}</span>
      </div>
      <Form form={form} layout="vertical" onFinish={handleSubmit} className="inline-login-form">
        <Form.Item
          label={isSetupMode ? 'Username' : 'Username or Member ID (e.g. MR#012)'}
          name="username"
          rules={[{ required: true, message: 'Please enter a username' }]}
        >
          <Input prefix={<UserOutlined />} placeholder="Username or Member ID" />
        </Form.Item>
        <Form.Item
          label="Password"
          name="password"
          rules={[
            { required: true, message: 'Please enter a password' },
            ...(isSetupMode ? [{ min: 6, message: 'Password must be at least 6 characters' }] : []),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Password" />
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
          <Button type="primary" htmlType="submit" loading={loading} block>
            {isSetupMode ? 'Create Account' : 'Log In'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
