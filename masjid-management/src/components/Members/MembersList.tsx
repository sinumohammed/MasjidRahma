import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Input, Segmented, Modal, Alert, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined, CheckCircleFilled, PhoneOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getMembers, type Member, type MemberType } from '../../services/api';
import MemberForm from './MemberForm';
import MemberAvatar from './MemberAvatar';
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

  const inRotation = members.filter((m) => m.member_type === 'regular' && m.active).length;
  const withNotifications = members.filter((m) => m.hasPushSubscription).length;

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
            <span
              className={`members-avatar-ring ${record.hasPushSubscription ? 'online' : 'offline'}`}
            >
              <MemberAvatar uniqueId={record.unique_id} size={36} />
            </span>
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
              <span className={`m-pill ${record.member_type === 'non_rotation' ? 'is-gold' : ''}`}>
                {record.member_type === 'non_rotation' ? 'Non-rotation' : 'Regular'}
              </span>
              <span className="members-family-count">
                {record.member_count} {record.member_count === 1 ? 'person' : 'people'}
              </span>
              {record.phone && (
                <a className="members-phone-inline" href={`tel:${record.phone.replace(/\s+/g, '')}`}>
                  <PhoneOutlined /> {record.phone}
                </a>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 150,
      responsive: ['md'],
      render: (phone: string) =>
        phone ? (
          <a className="members-phone" href={`tel:${phone.replace(/\s+/g, '')}`}>
            {phone}
          </a>
        ) : (
          '-'
        ),
    },
    ...(isAdmin
      ? [
          {
            title: '',
            key: 'actions',
            width: 56,
            align: 'right' as const,
            render: (_: unknown, record: Member) => (
              <Tooltip title="Edit">
                <Button icon={<EditOutlined />} type="text" onClick={() => handleEditClick(record)} aria-label={`Edit ${record.name}`} />
              </Tooltip>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="m-page members-page">
      <div className="m-page-head">
        <div className="m-page-head-text">
          <h1 className="m-page-title">Members</h1>
          <span className="m-page-sub">
            {members.length} households · {inRotation} in the food rotation · {withNotifications} with notifications on
          </span>
        </div>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick} className="add-member-btn">
            <span className="add-member-btn-label">Add member</span>
          </Button>
        )}
      </div>

      {error && <Alert message="Could not load the members" description={error} type="error" showIcon />}

      <div className="m-card m-toolbar">
        <Input
          placeholder="Search by name, member ID, address or phone"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="filter-search"
        />
        <Segmented
          value={typeFilter ?? 'all'}
          onChange={(v) => setTypeFilter(v === 'all' ? undefined : (v as MemberType))}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Regular', value: 'regular' },
            { label: 'Non-rotation', value: 'non_rotation' },
          ]}
        />
      </div>

      <div className="m-card m-table-card">
      <Table
        columns={columns}
        dataSource={filteredMembers}
        rowKey="id"
        loading={loading}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        className="members-table"
        locale={{ emptyText: searchText || typeFilter ? 'No member matches' : 'No members yet' }}
      />
      </div>

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
