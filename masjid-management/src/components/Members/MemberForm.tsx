import { useState } from 'react';
import { Form, Input, InputNumber, Select, Button, Switch, Space, DatePicker, message } from 'antd';
import dayjs from 'dayjs';
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
  const paymentFrequency = Form.useWatch('paymentFrequency', form);

  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);

      const hasDuesStart =
        (values.paymentFrequency === 'monthly' || values.paymentFrequency === 'yearly') && values.duesStart;
      const duesStartYear = hasDuesStart ? values.duesStart.year() : null;
      // Yearly plans only ask for a year (see the picker below) - always
      // treat that as January of that year for the monthsElapsed math.
      const duesStartMonthIndex = hasDuesStart
        ? values.paymentFrequency === 'yearly'
          ? 0
          : values.duesStart.month()
        : null;

      if (isEditMode && member) {
        await updateMember(member.id, {
          name: values.name,
          address: values.address,
          phone: values.phone,
          memberCount: values.memberCount,
          active: values.active,
          paymentAmount: values.paymentAmount ?? null,
          paymentFrequency: values.paymentFrequency ?? null,
          memberType: values.memberType,
          duesStartYear,
          duesStartMonthIndex,
        });
        message.success('Member updated successfully!');
      } else {
        await createMember({
          name: values.name,
          address: values.address,
          phone: values.phone,
          memberCount: values.memberCount,
          paymentAmount: values.paymentAmount ?? null,
          paymentFrequency: values.paymentFrequency ?? null,
          memberType: values.memberType,
          duesStartYear,
          duesStartMonthIndex,
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
                paymentAmount: member.payment_amount ?? undefined,
                paymentFrequency: member.payment_frequency ?? undefined,
                memberType: member.member_type,
                duesStart:
                  member.dues_start_year != null && member.dues_start_month != null
                    ? dayjs().year(member.dues_start_year).month(member.dues_start_month).date(1)
                    : undefined,
              }
            : { active: true, memberType: 'regular' }
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

        <Form.Item label="Recurring Payment Amount (optional)" name="paymentAmount">
          <InputNumber placeholder="e.g. 500" min={0} step={1} className="form-number" style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="Payment Frequency" name="paymentFrequency">
          <Select
            placeholder="Select frequency"
            allowClear
            options={[
              { label: 'Monthly', value: 'monthly' },
              { label: 'Yearly', value: 'yearly' },
            ]}
          />
        </Form.Item>

        {(paymentFrequency === 'monthly' || paymentFrequency === 'yearly') && (
          <Form.Item
            label={paymentFrequency === 'yearly' ? 'Dues Start Year (optional)' : 'Dues Start Month (optional)'}
            name="duesStart"
            tooltip={
              paymentFrequency === 'monthly'
                ? 'If this member only actually started paying from a certain month (e.g. joined mid-year), set it here so earlier months show as Nil instead of Missed - without needing a matching transaction. Leave blank to keep the default (every year owed from January).'
                : "If this member's dues should be counted from a different year than when their record was created (e.g. added late but should count from an earlier or later join year), set it here. Leave blank to use the record's created date."
            }
          >
            <DatePicker
              picker={paymentFrequency === 'yearly' ? 'year' : 'month'}
              placeholder={paymentFrequency === 'yearly' ? 'Select start year' : 'Select start month'}
              style={{ width: '100%' }}
              allowClear
            />
          </Form.Item>
        )}

        <Form.Item
          label="Food Supply Rotation"
          name="memberType"
          rules={[{ required: true, message: 'Please select a rotation type' }]}
          tooltip="Non-rotation members are managed normally (payments, profile, etc.) but are never included in the food-day schedule or assignment."
        >
          <Select
            options={[
              { label: 'Regular (included in food rotation)', value: 'regular' },
              { label: 'Non-Rotation (no food duty)', value: 'non_rotation' },
            ]}
          />
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
