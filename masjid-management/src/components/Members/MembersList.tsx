import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Button, Input, Select, Space, Modal, Alert, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined, CheckCircleFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getMembers, type Member, type MemberType } from '../../services/api';
import MemberForm from './MemberForm';
import { useAuth } from '../../context/AuthContext';
import './MembersList.css';

interface MembersListProps {
  initialTypeFilter?: MemberType;
}

export default function MembersList({ initialTypeFilter }: MembersListProps) {
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemberType | undefined>(initialTypeFilter);

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
    return members.filter((m) => {
      if (typeFilter && m.member_type !== typeFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!`${m.unique_id} ${m.name} ${m.address} ${m.phone}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [members, searchText, typeFilter]);

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
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.position - b.position,
      render: (name: string, record: Member) => (
        <div className="members-name-cell">
          <Tooltip title={record.hasPushSubscription ? 'Notifications enabled' : 'Notifications disabled'}>
            <span className={`members-status-dot ${record.hasPushSubscription ? 'active' : 'inactive'}`} />
          </Tooltip>
          <div className="members-name-text-wrap">
            <div className="members-name-text">
              {name}
              {record.active && (
                <Tooltip title="Active member">
                  <CheckCircleFilled className="members-active-tick" />
                </Tooltip>
              )}
            </div>
            <div className="members-name-meta">
              <span className="members-name-id">{record.unique_id}</span>
              <Tag
                color={record.member_type === 'non_rotation' ? 'orange' : 'blue'}
                className="members-type-tag"
              >
                {record.member_type === 'non_rotation' ? 'Non-Rotation' : 'Regular'}
              </Tag>
              <span className="members-family-count">👪 {record.member_count}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
    },
    ...(isAdmin
      ? [
          {
            title: 'Actions',
            key: 'actions',
            width: 90,
            fixed: 'right' as const,
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
        <Select
          placeholder="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          allowClear
          className="filter-select"
          options={[
            { label: 'Regular', value: 'regular' },
            { label: 'Non-Rotation', value: 'non_rotation' },
          ]}
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
