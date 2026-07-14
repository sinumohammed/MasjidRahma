import { useState } from 'react';
import { Form, Input, InputNumber, Button, Switch, Space, message } from 'antd';
import { createMember, updateMember, type Member } from '../../services/api';
import './MemberForm.css';

interface MemberFormProps {
  member?: Member;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function MemberForm({ member, onSuccess, onCancel }: MemberFormProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isEditMode = Boolean(member);

  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);

      if (isEditMode && member) {
        await updateMember(member.id, {
          name: values.name,
          address: values.address,
          phone: values.phone,
          memberCount: values.memberCount,
          active: values.active,
        });
        message.success('Member updated successfully!');
      } else {
        await createMember({
          name: values.name,
          address: values.address,
          phone: values.phone,
          memberCount: values.memberCount,
        });
        message.success('Member added successfully!');
      }
      form.resetFields();
      onSuccess();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save member';
      message.error(errorMessage);
      console.error('Error saving member:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="member-form-container">
      <h2 className="form-title">{isEditMode ? '✏️ Edit Member' : '➕ Add New Member'}</h2>

      {isEditMode && member && (
        <div className="member-form-id-badge">{member.unique_id}</div>
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        className="member-form"
        initialValues={
          member
            ? {
                name: member.name,
                address: member.address,
                phone: member.phone,
                memberCount: member.member_count,
                active: member.active,
              }
            : { active: true }
        }
      >
        <Form.Item
          label="Home / Family Name"
          name="name"
          rules={[{ required: true, message: 'Please enter a name' }]}
        >
          <Input placeholder="e.g. Rahman Family" className="form-input" />
        </Form.Item>

        <Form.Item
          label="Address"
          name="address"
          rules={[{ required: true, message: 'Please enter an address' }]}
        >
          <Input.TextArea placeholder="Home address" rows={2} className="form-textarea" />
        </Form.Item>

        <Form.Item
          label="Phone Number"
          name="phone"
          rules={[
            { required: true, message: 'Please enter a phone number' },
            { pattern: /^[0-9+\-() ]{7,20}$/, message: 'Enter a valid phone number' },
          ]}
        >
          <Input placeholder="e.g. +1 555 123 4567" className="form-input" />
        </Form.Item>

        <Form.Item
          label="Number of Members in Home"
          name="memberCount"
          rules={[
            { required: true, message: 'Please enter member count' },
            {
              validator: (_, value) => {
                if (Number.isInteger(value) && value > 0) return Promise.resolve();
                return Promise.reject(new Error('Must be a positive whole number'));
              },
            },
          ]}
        >
          <InputNumber placeholder="e.g. 4" min={1} step={1} className="form-number" />
        </Form.Item>

        {isEditMode && (
          <Form.Item label="Active in Rotation" name="active" valuePropName="checked">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        )}

        <Form.Item>
          <Space className="form-actions" style={{ width: '100%', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={onCancel} disabled={loading} className="form-button-cancel">
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={loading} className="form-button-submit">
              {isEditMode ? 'Save' : 'Add'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
