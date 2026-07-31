import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  DatePicker,
  Space,
  Modal,
  message,
  Popconfirm,
  Alert,
  Tooltip,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import {
  getTransactions,
  deleteTransaction,
  getMembers,
  type Transaction,
  type Member,
} from '../services/api';
import TransactionForm from './TransactionForm';
import TransactionReceipt from './TransactionReceipt';
import MemberAvatar from './Members/MemberAvatar';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import './TransactionsList.css';

const { RangePicker } = DatePicker;

interface TransactionsListProps {
  initialTypeFilter?: string;
  initialCategoryFilter?: string;
}

export default function TransactionsList({ initialTypeFilter, initialCategoryFilter }: TransactionsListProps) {
  const { currencySymbol } = useSettings();
  const { isAdmin } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(initialTypeFilter);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(initialCategoryFilter);
  const [memberFilter, setMemberFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [receiptTransaction, setReceiptTransaction] = useState<Transaction | undefined>();

  const loadTransactions = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getTransactions();
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    getMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.category))).sort(),
    [transactions]
  );

  const memberOptions = useMemo(
    () =>
      [...members]
        .sort((a, b) => a.position - b.position)
        .map((m) => ({ label: `${m.name} (${m.unique_id})`, value: m.id })),
    [members]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (typeFilter && t.type !== typeFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (memberFilter && t.member_id !== memberFilter) return false;
      if (dateRange) {
        const d = dayjs(t.date);
        if (d.isBefore(dateRange[0], 'day') || d.isAfter(dateRange[1], 'day')) return false;
      }
      if (searchText) {
        const q = searchText.toLowerCase();
        const haystack = `${t.category} ${t.description}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, typeFilter, categoryFilter, memberFilter, dateRange, searchText]);

  const handleAddClick = () => {
    setEditingTransaction(undefined);
    setIsModalOpen(true);
  };

  const handleEditClick = (record: Transaction) => {
    setEditingTransaction(record);
    setIsModalOpen(true);
  };

  const handlePrintReceiptClick = (record: Transaction) => {
    setReceiptTransaction(record);
  };

  const handleFormSuccess = () => {
    setIsModalOpen(false);
    setEditingTransaction(undefined);
    loadTransactions();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTransaction(id);
      message.success('Transaction deleted');
      loadTransactions();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to delete transaction');
    }
  };

  const columns: ColumnsType<Transaction> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
      width: 120,
    },
    {
      title: 'Member',
      dataIndex: 'member_id',
      key: 'member_id',
      width: 96,
      align: 'center',
      render: (memberId: string | null) => {
        const member = membersById.get(memberId ?? '');
        return (
          <Tooltip title={member ? member.name : 'No member linked'}>
            <div className="transaction-member-cell">
              <MemberAvatar key={member?.unique_id ?? 'none'} uniqueId={member?.unique_id} size={28} />
              {member && <Tag className="transaction-member-id-chip">{member.unique_id}</Tag>}
            </div>
          </Tooltip>
        );
      },
    },
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
    ...(isAdmin
      ? [
          {
            title: 'Actions',
            key: 'actions',
            width: 120,
            fixed: 'right' as const,
            render: (_: unknown, record: Transaction) => (
              <Space>
                {record.type === 'income' && (
                  <Button
                    icon={<PrinterOutlined />}
                    size="small"
                    title="Print Receipt"
                    onClick={() => handlePrintReceiptClick(record)}
                  />
                )}
                <Button
                  icon={<EditOutlined />}
                  size="small"
                  onClick={() => handleEditClick(record)}
                />
                <Popconfirm
                  title="Delete this transaction?"
                  description="This action cannot be undone."
                  onConfirm={() => handleDelete(record.id)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button icon={<DeleteOutlined />} size="small" danger />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="transactions-list-container">
      <div className="transactions-header">
        <h1 className="transactions-title">📋 Transactions</h1>
        {isAdmin && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={handleAddClick}
            className="add-transaction-btn"
          >
            <span className="add-transaction-btn-label">Add Transaction</span>
          </Button>
        )}
      </div>

      {error && (
        <Alert
          message="Error Loading Transactions"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      <div className="transactions-filters">
        <Input
          placeholder="Search category or description"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="filter-search"
        />
        <Select
          placeholder="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          allowClear
          className="filter-select"
          options={[
            { label: '💰 Income', value: 'income' },
            { label: '💸 Expense', value: 'expense' },
          ]}
        />
        <Select
          placeholder="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          allowClear
          className="filter-select"
          options={categories.map((c) => ({ label: c, value: c }))}
        />
        <Select
          placeholder="Member"
          value={memberFilter}
          onChange={setMemberFilter}
          allowClear
          showSearch
          optionFilterProp="label"
          className="filter-select"
          options={memberOptions}
        />
        <RangePicker
          value={dateRange}
          onChange={(range) => setDateRange(range as [Dayjs, Dayjs] | null)}
          className="filter-date-range"
        />
      </div>

      <Table
        columns={columns}
        dataSource={filteredTransactions}
        rowKey="id"
        loading={loading}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        className="transactions-table"
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={null}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingTransaction(undefined);
        }}
        footer={null}
        width={700}
        styles={{ body: { padding: 0 } }}
        className="transaction-modal"
      >
        <TransactionForm
          key={editingTransaction?.id ?? 'new'}
          transaction={editingTransaction}
          onSuccess={handleFormSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingTransaction(undefined);
          }}
        />
      </Modal>

      <Modal
        title={null}
        open={!!receiptTransaction}
        onCancel={() => setReceiptTransaction(undefined)}
        footer={null}
        width={560}
        styles={{ body: { padding: 0 } }}
        className="receipt-modal"
      >
        {receiptTransaction && (
          <TransactionReceipt
            transaction={receiptTransaction}
            member={
              receiptTransaction.member_id
                ? membersById.get(receiptTransaction.member_id)
                : undefined
            }
          />
        )}
      </Modal>
    </div>
  );
}
