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
  Segmented,
  Grid,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  PrinterOutlined,
  FilterOutlined,
  MoreOutlined,
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
import { money } from '../utils/money';
import { shortDate } from '../utils/dates';
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // Selection is scoped to the currently-filtered rows - clear it whenever
  // a filter changes so a stale selected id from a now-hidden row can't be
  // bulk-deleted without the admin seeing it.
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [typeFilter, categoryFilter, memberFilter, dateRange, searchText]);

  // Phones: one compact row - category with date and description, the
  // amount, and a ⋯ menu for print / edit / delete (no select boxes).
  const compact = !Grid.useBreakpoint().md;
  const confirmDelete = (record: Transaction) =>
    Modal.confirm({
      title: 'Delete this transaction?',
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    });

  // Phones: category, member and dates fold away behind "Filters".
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [categoryFilter, memberFilter, dateRange].filter(Boolean).length;

  const totalIn = filteredTransactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + Number(t.amount), 0);
  const totalOut = filteredTransactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount), 0);

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

  // No dedicated bulk-delete endpoint - fires one DELETE per selected row.
  const handleBulkDelete = async () => {
    try {
      setBulkDeleting(true);
      await Promise.all(selectedRowKeys.map((id) => deleteTransaction(id)));
      message.success(`${selectedRowKeys.length} transaction(s) deleted`);
      setSelectedRowKeys([]);
      loadTransactions();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to delete selected transactions');
    } finally {
      setBulkDeleting(false);
    }
  };

  const columns: ColumnsType<Transaction> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: (date: string) => <span className="transactions-date">{shortDate(date)}</span>,
      width: 118,
      responsive: ['md'],
    },
    {
      title: 'Member',
      dataIndex: 'member_id',
      key: 'member_id',
      width: 96,
      align: 'center',
      responsive: ['md'],
      render: (memberId: string | null) => {
        const member = membersById.get(memberId ?? '');
        return (
          <Tooltip title={member ? member.name : 'No member linked'}>
            <div className="transaction-member-cell">
              <MemberAvatar key={member?.unique_id ?? 'none'} uniqueId={member?.unique_id} size={28} />
              {member && <span className="transaction-member-id-chip">{member.unique_id}</span>}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (category: string, record) => (
        <div className="transactions-category">
          <span>{category}</span>
          <span className="transactions-desc-inline transactions-date-inline">{shortDate(record.date)}</span>
          {/* On a phone the description is here, not in its own column. */}
          {record.description && <span className="transactions-desc-inline">{record.description}</span>}
        </div>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      sorter: (a, b) => a.amount - b.amount,
      align: 'right',
      width: compact ? 104 : 120,
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
      ellipsis: { showTitle: true },
      responsive: ['md'],
    },
    ...(isAdmin
      ? [
          {
            title: '',
            key: 'actions',
            width: compact ? 44 : 112,
            align: 'right' as const,
            render: (_: unknown, record: Transaction) =>
              compact ? (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      ...(record.type === 'income' ? [{ key: 'print', icon: <PrinterOutlined />, label: 'Print receipt' }] : []),
                      { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
                      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
                    ],
                    onClick: ({ key }) =>
                      key === 'print' ? handlePrintReceiptClick(record) : key === 'edit' ? handleEditClick(record) : confirmDelete(record),
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} aria-label="Actions" />
                </Dropdown>
              ) : (
              <Space size={0}>
                {record.type === 'income' && (
                  <Tooltip title="Print receipt">
                    <Button icon={<PrinterOutlined />} type="text" size="small" onClick={() => handlePrintReceiptClick(record)} aria-label="Print receipt" />
                  </Tooltip>
                )}
                <Tooltip title="Edit">
                  <Button icon={<EditOutlined />} type="text" size="small" onClick={() => handleEditClick(record)} aria-label="Edit" />
                </Tooltip>
                <Popconfirm
                  title="Delete this transaction?"
                  description="This action cannot be undone."
                  onConfirm={() => handleDelete(record.id)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button icon={<DeleteOutlined />} type="text" size="small" danger aria-label="Delete" />
                </Popconfirm>
              </Space>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="m-page transactions-page">
      <div className="m-page-head">
        <div className="m-page-head-text">
          <h1 className="m-page-title">Transactions</h1>
          <span className="m-page-sub">
            {filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'} ·{' '}
            <span className="m-amount is-in">
              {currencySymbol}
              {money(totalIn)}
            </span>{' '}
            in ·{' '}
            <span className="m-amount is-out">
              {currencySymbol}
              {money(totalOut)}
            </span>{' '}
            out
          </span>
        </div>
        {isAdmin && (
          <Space>
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`Delete ${selectedRowKeys.length} selected transaction(s)?`}
                description="This action cannot be undone."
                onConfirm={handleBulkDelete}
                okText="Delete"
                okButtonProps={{ danger: true, loading: bulkDeleting }}
              >
                <Button danger icon={<DeleteOutlined />} loading={bulkDeleting}>
                  Delete ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick} className="add-transaction-btn">
              <span className="add-transaction-btn-label">Add transaction</span>
            </Button>
          </Space>
        )}
      </div>

      {error && <Alert message="Could not load the transactions" description={error} type="error" showIcon />}

      <div className="m-card m-toolbar transactions-filters">
        <Input
          placeholder="Search category or description"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="filter-search"
        />
        <Segmented
          value={typeFilter ?? 'all'}
          onChange={(v) => setTypeFilter(v === 'all' ? undefined : (v as 'income' | 'expense'))}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Income', value: 'income' },
            { label: 'Expense', value: 'expense' },
          ]}
          className="filter-type"
        />
        <Button className="transactions-filters-toggle" icon={<FilterOutlined />} onClick={() => setFiltersOpen((o) => !o)}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        <div className={`transactions-more-filters${filtersOpen ? ' is-open' : ''}`}>
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
      </div>

      <div className="m-card m-table-card">
      <Table
        columns={columns}
        dataSource={filteredTransactions}
        rowKey="id"
        loading={loading}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        className="transactions-table"
        tableLayout="fixed"
        rowSelection={
          isAdmin && !compact
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
      />
      </div>

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
