import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Button, Input, Space, Modal, Alert } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getMembers, type Member } from '../../services/api';
import MemberForm from './MemberForm';
import { useAuth } from '../../context/AuthContext';
import './MembersList.css';

export default function MembersList() {
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | undefined>();

  const loadMembers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMembers();
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!searchText) return members;
    const q = searchText.toLowerCase();
    return members.filter((m) => `${m.unique_id} ${m.name} ${m.address} ${m.phone}`.toLowerCase().includes(q));
  }, [members, searchText]);

  const handleAddClick = () => {
    setEditingMember(undefined);
    setIsModalOpen(true);
  };

  const handleEditClick = (record: Member) => {
    setEditingMember(record);
    setIsModalOpen(true);
  };

  const handleFormSuccess = () => {
    setIsModalOpen(false);
    setEditingMember(undefined);
    loadMembers();
  };

  const columns: ColumnsType<Member> = [
    {
      title: 'ID',
      dataIndex: 'unique_id',
      key: 'unique_id',
      width: 100,
      sorter: (a, b) => a.position - b.position,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Address',
      dataIndex: 'address',
      key: 'address',
      ellipsis: true,
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
    },
    {
      title: 'Members',
      dataIndex: 'member_count',
      key: 'member_count',
      width: 100,
      sorter: (a, b) => a.member_count - b.member_count,
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      width: 110,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
      ),
    },
    ...(isAdmin
      ? [
          {
            title: 'Actions',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: Member) => (
              <Space>
                <Button icon={<EditOutlined />} size="small" onClick={() => handleEditClick(record)} />
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="members-list-container">
      <div className="members-header">
        <h1 className="members-title">🏠 Members</h1>
        {isAdmin && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={handleAddClick}
            className="add-member-btn"
          >
            <span className="add-member-btn-label">Add Member</span>
          </Button>
        )}
      </div>

      {error && (
        <Alert
          message="Error Loading Members"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      <div className="members-filters">
        <Input
          placeholder="Search by ID, name, or address"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="filter-search"
        />
      </div>

      <Table
        columns={columns}
        dataSource={filteredMembers}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        className="members-table"
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={null}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingMember(undefined);
        }}
        footer={null}
        width={600}
        styles={{ body: { padding: 0 } }}
        className="member-modal"
      >
        <MemberForm
          key={editingMember?.id ?? 'new'}
          member={editingMember}
          onSuccess={handleFormSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingMember(undefined);
          }}
        />
      </Modal>
    </div>
  );
}
