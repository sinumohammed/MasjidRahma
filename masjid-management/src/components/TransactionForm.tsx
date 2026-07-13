import { useState } from 'react';
import { Form, Input, InputNumber, Button, Select, DatePicker, Space, message } from 'antd';
import { createTransaction, updateTransaction, type Transaction } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import dayjs from 'dayjs';
import './TransactionForm.css';

interface TransactionFormProps {
  transaction?: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function TransactionForm({ transaction, onSuccess, onCancel }: TransactionFormProps) {
  const { currencySymbol } = useSettings();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isEditMode = Boolean(transaction);

  const transactionTypes = [
    { label: '💰 Income', value: 'income' },
    { label: '💸 Expense', value: 'expense' },
  ];

  const categories = {
    income: [
      { label: 'Donation', value: 'Donation' },
      { label: 'Zakat', value: 'Zakat' },
      { label: 'Masjid Fund', value: 'Masjid Fund' },
      { label: 'Other Income', value: 'Other Income' },
    ],
    expense: [
      { label: 'Utilities', value: 'Utilities' },
      { label: 'Maintenance', value: 'Maintenance' },
      { label: 'Supplies', value: 'Supplies' },
      { label: 'Staff', value: 'Staff' },
      { label: 'Events', value: 'Events' },
      { label: 'Miscellaneous', value: 'Miscellaneous' },
    ],
  };

  const selectedType = Form.useWatch('type', form);

  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);

      const transactionData = {
        type: values.type,
        category: values.category,
        amount: values.amount,
        description: values.description || '',
        date: values.date ? values.date.toISOString() : new Date().toISOString(),
      };

      if (isEditMode && transaction) {
        await updateTransaction(transaction.id, transactionData);
        message.success('Transaction updated successfully!');
      } else {
        await createTransaction(transactionData);
        message.success('Transaction added successfully!');
      }
      form.resetFields();
      onSuccess();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save transaction';
      message.error(errorMessage);
      console.error('Error saving transaction:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="transaction-form-container">
      <h2 className="form-title">{isEditMode ? '✏️ Edit Transaction' : '➕ Add New Transaction'}</h2>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        className="transaction-form"
        initialValues={
          transaction
            ? {
                type: transaction.type,
                category: transaction.category,
                amount: transaction.amount,
                description: transaction.description,
                date: dayjs(transaction.date),
              }
            : undefined
        }
      >
        {/* Type Selection */}
        <Form.Item
          label="Transaction Type"
          name="type"
          rules={[{ required: true, message: 'Please select transaction type' }]}
        >
          <Select
            placeholder="Select income or expense"
            options={transactionTypes}
            className="form-select"
          />
        </Form.Item>

        {/* Category Selection */}
        <Form.Item
          label="Category"
          name="category"
          rules={[{ required: true, message: 'Please select a category' }]}
        >
          <Select
            placeholder="Select category"
            options={selectedType ? categories[selectedType as keyof typeof categories] : []}
            className="form-select"
            disabled={!selectedType}
          />
        </Form.Item>

        {/* Amount */}
        <Form.Item
          label={`Amount (${currencySymbol})`}
          name="amount"
          rules={[
            { required: true, message: 'Please enter amount' },
            {
              validator: (_, value) => {
                if (value && value > 0) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Amount must be greater than 0'));
              },
            },
          ]}
        >
          <InputNumber
            placeholder="0.00"
            min={0}
            step={0.01}
            precision={2}
            className="form-number"
            prefix={currencySymbol}
          />
        </Form.Item>

        {/* Description */}
        <Form.Item
          label="Description (Optional)"
          name="description"
        >
          <Input.TextArea
            placeholder="Add notes or details about this transaction"
            rows={3}
            maxLength={500}
            showCount
            className="form-textarea"
          />
        </Form.Item>

        {/* Date */}
        <Form.Item
          label="Transaction Date"
          name="date"
          initialValue={dayjs()}
          rules={[{ required: true, message: 'Please select date' }]}
        >
          <DatePicker
            format="YYYY-MM-DD"
            className="form-date"
            disabledDate={(current) => {
              // Can't select dates in the future
              return current && current > dayjs().endOf('day');
            }}
          />
        </Form.Item>

        {/* Buttons */}
        <Form.Item>
          <Space className="form-actions" style={{ width: '100%', justifyContent: 'flex-end', gap: '8px' }}>
            <Button 
              onClick={onCancel}
              disabled={loading}
              className="form-button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              className="form-button-submit"
            >
              {isEditMode ? 'Save Changes' : 'Add Transaction'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
