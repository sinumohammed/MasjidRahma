import { useEffect, useMemo, useState } from 'react';
import { Table, Spin, Alert, Tag, Button, Modal, Form, Input, InputNumber, message } from 'antd';
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

  const columns: ColumnsType<Transaction> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      defaultSortOrder: 'descend',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
      width: 120,
    },
    ...(!selectedBankId
      ? [
          {
            title: 'Bank',
            dataIndex: 'bank_id',
            key: 'bank_id',
            width: 120,
            render: (bankId: string | null) => banks.find((b) => b.id === bankId)?.name ?? '—',
          },
        ]
      : []),
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      sorter: (a, b) => a.amount - b.amount,
      render: (amount: number, record) => (
        <span style={{ color: record.type === 'income' ? '#52c41a' : '#f5222d', fontWeight: 600 }}>
          {record.type === 'income' ? '+' : '-'}{currencySymbol}{amount.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
  ];

  if (loading) {
    return (
      <div className="banks-loading">
        <Spin size="large" tip="Loading banks..." />
      </div>
    );
  }

  if (error) {
    return <Alert message="Error Loading Banks" description={error} type="error" showIcon style={{ marginBottom: '16px' }} />;
  }

  return (
    <div className="banks-page-container">
      <div className="banks-header">
        <h1 className="banks-title">🏦 Banks</h1>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddBankModal} className="add-bank-btn">
            <span className="add-bank-btn-label">Add Bank</span>
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
            <span className="bank-card-label">All Banks</span>
            <span className="bank-card-value">
              {currencySymbol}{banks.reduce((sum, b) => sum + b.balance, 0).toFixed(2)}
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
                {currencySymbol}{bank.balance.toFixed(2)}
              </span>
              <span className="bank-card-opening">
                Opening: {currencySymbol}{bank.opening_balance.toFixed(2)}
              </span>
            </div>
            {isAdmin && (
              <Button
                icon={<EditOutlined />}
                size="small"
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

      <div className="banks-transactions-heading">
        {selectedBank ? (
          <>
            <span>{selectedBank.name} Transactions</span>
            <Tag color="blue">{bankTransactions.length}</Tag>
          </>
        ) : (
          <>
            <span>All Bank Transactions</span>
            <Tag color="blue">{bankTransactions.length}</Tag>
          </>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={bankTransactions}
        rowKey="id"
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        className="banks-transactions-table"
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editingBank ? 'Edit Bank' : 'Add Bank'}
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
            label={`Opening Balance (${currencySymbol})`}
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
