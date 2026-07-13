import { useState } from 'react';
import { Modal, Form, Input, Button, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AuthModal({ open, onClose }: AuthModalProps) {
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
        message.success('Logged in as admin');
      }
      form.resetFields();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isSetupMode ? '🔐 Create Admin Account' : '🔐 Admin Login'}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          label="Username"
          name="username"
          rules={[{ required: true, message: 'Please enter a username' }]}
        >
          <Input prefix={<UserOutlined />} placeholder="Username" autoFocus />
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
        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Button type="primary" htmlType="submit" loading={loading}>
            {isSetupMode ? 'Create Account' : 'Log In'}
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}
