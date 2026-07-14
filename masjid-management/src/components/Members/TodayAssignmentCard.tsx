import { useEffect, useState } from 'react';
import { Card, Tag, Button, Modal, Select, DatePicker, Radio, Space, message, Spin, Tooltip } from 'antd';
import { HomeOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import {
  getTodayAssignment,
  getMembers,
  createSwap,
  setCurrentMember,
  type Assignment,
  type Member,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import './TodayAssignmentCard.css';

function MemberAvatar({ uniqueId }: { uniqueId: string }) {
  const [ext, setExt] = useState<'png' | 'jpg' | null>('png');

  useEffect(() => {
    setExt('png');
  }, [uniqueId]);

  if (!ext) {
    return (
      <div className="today-assignment-icon">
        <HomeOutlined />
      </div>
    );
  }

  // '#' (as in 'MR#001') breaks static asset lookups even when percent-encoded,
  // so the file naming convention strips all non-alphanumeric characters.
  const fileName = uniqueId.replace(/[^a-zA-Z0-9]/g, '');

  return (
    <img
      src={`/assets/members/${fileName}.${ext}`}
      alt={uniqueId}
      className="today-assignment-photo"
      onError={() => setExt(ext === 'png' ? 'jpg' : null)}
    />
  );
}

type ModalMode = 'swap' | 'set-current';

export default function TodayAssignmentCard() {
  const { isAdmin } = useAuth();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('swap');
  const [members, setMembers] = useState<Member[]>([]);
  const [swapDate, setSwapDate] = useState<Dayjs>(dayjs());
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const loadAssignment = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getTodayAssignment();
      setAssignment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load today\'s assignment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignment();
    const interval = setInterval(loadAssignment, 300000);
    return () => clearInterval(interval);
  }, []);

  const openModal = async () => {
    setMode('swap');
    setSwapDate(dayjs());
    setSelectedMemberId(undefined);
    setModalOpen(true);
    try {
      const data = await getMembers();
      setMembers(data.filter((m) => m.active));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load members');
    }
  };

  const handleSubmit = async () => {
    if (!selectedMemberId) {
      message.error('Please select a home');
      return;
    }
    try {
      setSubmitting(true);
      if (mode === 'swap') {
        await createSwap(swapDate.format('YYYY-MM-DD'), selectedMemberId);
        message.success('Swap saved');
      } else {
        await setCurrentMember(selectedMemberId);
        message.success('Rotation updated - this home is now on duty, cycle continues from here');
      }
      setModalOpen(false);
      loadAssignment();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card className="today-assignment-card" bordered={false}>
        {loading ? (
          <Spin />
        ) : error ? (
          <div className="today-assignment-error">{error}</div>
        ) : !assignment?.member ? (
          <div className="today-assignment-empty">No active members set up yet.</div>
        ) : (
          <div className="today-assignment-body">
            <MemberAvatar uniqueId={assignment.member.unique_id} />
            <div className="today-assignment-info">
              <div className="today-assignment-heading">
                <span className="today-assignment-label">Food Supply Today</span>
                {assignment.swapped && <Tag color="orange">Swapped</Tag>}
              </div>
              <div className="today-assignment-name">{assignment.member.name}</div>
              <div className="today-assignment-phone">{assignment.member.phone}</div>
              {assignment.swapped && assignment.originalMember && (
                <div className="today-assignment-original">
                  Originally: {assignment.originalMember.name} ({assignment.originalMember.phone})
                </div>
              )}
            </div>
            {isAdmin && (
              <Tooltip title="Swap or set today's home">
                <Button
                  icon={<SwapOutlined />}
                  shape="circle"
                  size="large"
                  onClick={openModal}
                  className="today-assignment-swap-btn"
                />
              </Tooltip>
            )}
          </div>
        )}
      </Card>

      <Modal
        title="Adjust Food Supply Rotation"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText="Save"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { label: 'One-time swap for a day', value: 'swap' },
              { label: 'Set as current & continue from here', value: 'set-current' },
            ]}
            optionType="button"
            buttonStyle="solid"
          />

          {mode === 'swap' && (
            <div>
              <div className="swap-modal-field-label">Date</div>
              <DatePicker
                value={swapDate}
                onChange={(d) => d && setSwapDate(d)}
                format="YYYY-MM-DD"
                disabledDate={(current) => current && current < dayjs().startOf('day')}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div>
            <div className="swap-modal-field-label">Home</div>
            <Select
              placeholder="Select a home"
              value={selectedMemberId}
              onChange={setSelectedMemberId}
              style={{ width: '100%' }}
              options={members.map((m) => ({ label: `${m.unique_id} - ${m.name}`, value: m.id }))}
              showSearch
              optionFilterProp="label"
            />
          </div>

          <div className="swap-modal-hint">
            {mode === 'swap'
              ? "To swap two homes, save this once for each home's date."
              : 'This home takes over today, and the rotation continues in normal order from them onward - the rest of the current cycle is replaced.'}
          </div>
        </Space>
      </Modal>
    </>
  );
}
