import { useEffect, useMemo, useState } from 'react';
import { Table, Spin, Alert, Button, Modal, Form, Input, InputNumber, Grid, message } from 'antd';
import { BankOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  getBanks,
  getTransactions,
  createBank,
  updateBank,
  type Bank,
  type Transaction,
} from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { money } from '../../utils/money';
import { shortDate } from '../../utils/dates';
import './BanksPage.css';

interface BanksPageProps {
  initialBankId?: string;
}

export default function BanksPage({ initialBankId }: BanksPageProps) {
  const { currencySymbol } = useSettings();
  const { isAdmin } = useAuth();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string | undefined>(initialBankId);

  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | undefined>();
  const [bankSaving, setBankSaving] = useState(false);
  const [bankForm] = Form.useForm();

  useEffect(() => {
    setSelectedBankId(initialBankId);
  }, [initialBankId]);

  const loadBanks = async () => {
    const banksData = await getBanks();
    setBanks(banksData);
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [banksData, transactionsData] = await Promise.all([getBanks(), getTransactions()]);
        setBanks(banksData);
        setTransactions(transactionsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load banks');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const openAddBankModal = () => {
    setEditingBank(undefined);
    bankForm.resetFields();
    setIsBankModalOpen(true);
  };

  const openEditBankModal = (bank: Bank) => {
    setEditingBank(bank);
    bankForm.setFieldsValue({ name: bank.name, openingBalance: bank.opening_balance });
    setIsBankModalOpen(true);
  };

  const handleBankSubmit = async (values: { name: string; openingBalance: number }) => {
    try {
      setBankSaving(true);
      if (editingBank) {
        await updateBank(editingBank.id, values.name, values.openingBalance);
        message.success('Bank updated');
      } else {
        await createBank(values.name, values.openingBalance);
        message.success('Bank added');
      }
      setIsBankModalOpen(false);
      await loadBanks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save bank');
    } finally {
      setBankSaving(false);
    }
  };

  const bankTransactions = useMemo(
    () =>
      selectedBankId
        ? transactions.filter((t) => t.bank_id === selectedBankId)
        : transactions.filter((t) => t.bank_id),
    [transactions, selectedBankId]
  );

  const selectedBank = banks.find((b) => b.id === selectedBankId);

  // Phones: the date and bank go under the category; the amount stays in view.
  const compact = !Grid.useBreakpoint().md;
  const bankName = (bankId: string | null) => banks.find((b) => b.id === bankId)?.name ?? '—';

  const columns: ColumnsType<Transaction> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      defaultSortOrder: 'descend',
      render: (date: string) => <span className="transactions-date">{shortDate(date)}</span>,
      width: 120,
      responsive: ['md'],
    },
    ...(!selectedBankId
      ? [
          {
            title: 'Bank',
            dataIndex: 'bank_id',
            key: 'bank_id',
            width: 120,
            responsive: ['md'] as ('md')[],
            render: (bankId: string | null) => bankName(bankId),
          },
        ]
      : []),
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (category: string, record) =>
        compact ? (
          <div className="transactions-category">
            <span>{category}</span>
            <span className="banks-entry-meta">
              {shortDate(record.date)}
              {!selectedBankId && ` · ${bankName(record.bank_id)}`}
            </span>
          </div>
        ) : (
          category
        ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      sorter: (a, b) => a.amount - b.amount,
      align: 'right',
      width: compact ? 110 : 130,
      render: (amount: number, record) => (
        <span className={`m-amount ${record.type === 'income' ? 'is-in' : 'is-out'}`}>
          {record.type === 'income' ? '+' : '−'}
          {currencySymbol}
          {money(amount)}
        </span>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      responsive: ['md'],
    },
  ];

  if (loading) {
    return (
      <div className="banks-loading">
        <Spin size="large" description="Loading banks..." />
      </div>
    );
  }

  if (error) {
    return <Alert message="Could not load the banks" description={error} type="error" showIcon />;
  }

  return (
    <div className="m-page banks-page">
      <div className="m-page-head">
        <div className="m-page-head-text">
          <h1 className="m-page-title">Banks</h1>
          <span className="m-page-sub">Where the masjid's money is - tap an account to see its entries</span>
        </div>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddBankModal} className="add-bank-btn">
            <span className="add-bank-btn-label">Add bank</span>
          </Button>
        )}
      </div>

      <div className="bank-card-row">
        <div
          className={`bank-card all-bank-card ${!selectedBankId ? 'selected' : ''}`}
          onClick={() => setSelectedBankId(undefined)}
        >
          <div className="bank-card-icon">
            <BankOutlined />
          </div>
          <div className="bank-card-body">
            <span className="bank-card-label">All accounts</span>
            <span className="bank-card-value">
              {currencySymbol}
              {money(banks.reduce((sum, b) => sum + b.balance, 0))}
            </span>
            <span className="bank-card-opening">
              {banks.length} {banks.length === 1 ? 'account' : 'accounts'}
            </span>
          </div>
        </div>

        {banks.map((bank) => (
          <div
            key={bank.id}
            className={`bank-card ${selectedBankId === bank.id ? 'selected' : ''}`}
            onClick={() => setSelectedBankId(bank.id)}
          >
            <div className="bank-card-icon">
              <BankOutlined />
            </div>
            <div className="bank-card-body">
              <span className="bank-card-label">{bank.name}</span>
              <span className={`bank-card-value ${bank.balance < 0 ? 'negative' : ''}`}>
                {currencySymbol}
                {money(bank.balance)}
              </span>
              <span className="bank-card-opening">
                Opening {currencySymbol}
                {money(bank.opening_balance)}
              </span>
            </div>
            {isAdmin && (
              <Button
                icon={<EditOutlined />}
                size="small"
                type="text"
                aria-label={`Edit ${bank.name}`}
                className="bank-card-edit-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditBankModal(bank);
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="m-card m-table-card">
      <div className="banks-transactions-heading">
        <span>{selectedBank ? `${selectedBank.name}: entries` : 'All entries'}</span>
        <span className="m-pill is-muted">{bankTransactions.length}</span>
      </div>

      <Table
        columns={columns}
        dataSource={bankTransactions}
        rowKey="id"
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        className="banks-transactions-table"
        tableLayout="fixed"
      />
      </div>

      <Modal
        title={editingBank ? 'Edit bank' : 'Add a bank'}
        open={isBankModalOpen}
        onCancel={() => setIsBankModalOpen(false)}
        footer={null}
      >
        <Form form={bankForm} layout="vertical" onFinish={handleBankSubmit}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a bank name' }]}
          >
            <Input placeholder="e.g. Bank, Committee" />
          </Form.Item>
          <Form.Item
            label={`Opening balance (${currencySymbol})`}
            name="openingBalance"
            initialValue={0}
            rules={[{ required: true, message: 'Please enter an opening balance' }]}
          >
            <InputNumber style={{ width: '100%' }} step={0.01} precision={2} prefix={currencySymbol} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button onClick={() => setIsBankModalOpen(false)} style={{ marginRight: 8 }}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={bankSaving}>
              {editingBank ? 'Save' : 'Add'}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
