import { useEffect, useState } from 'react';
import { Card, Tag, Button, Modal, Select, DatePicker, Radio, Space, message, Spin, Tooltip } from 'antd';
import { SwapOutlined, PhoneOutlined, UndoOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import {
  getTodayAssignment,
  getMembers,
  createSwap,
  createMutualSwap,
  deleteSwap,
  setCurrentMember,
  getMasjidToday,
  type Assignment,
  type Member,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import MemberAvatar from './MemberAvatar';
import './TodayAssignmentCard.css';

// The masjid's "today" (Asia/Kolkata), not the browser's local "today" - a
// swap saved under the browser's local date can silently miss the date the
// backend/dashboard actually treat as today when they differ.
const masjidTodayDayjs = () => dayjs(getMasjidToday().dateString);

type ModalMode = 'swap' | 'mutual' | 'set-current';

export default function TodayAssignmentCard() {
  const { isAdmin } = useAuth();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('swap');
  const [members, setMembers] = useState<Member[]>([]);
  const [swapDate, setSwapDate] = useState<Dayjs>(masjidTodayDayjs());
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>();
  const [otherSwapDate, setOtherSwapDate] = useState<Dayjs>(masjidTodayDayjs());
  const [submitting, setSubmitting] = useState(false);
  const [reverting, setReverting] = useState(false);

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
    setSwapDate(masjidTodayDayjs());
    setOtherSwapDate(masjidTodayDayjs().add(1, 'day'));
    setSelectedMemberId(undefined);
    setModalOpen(true);
    try {
      const data = await getMembers();
      setMembers(data.filter((m) => m.active));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load members');
    }
  };

  const handleRevert = async () => {
    if (!assignment) return;
    try {
      setReverting(true);
      await deleteSwap(assignment.date);
      message.success('Swap reverted to the original home');
      loadAssignment();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to revert swap');
    } finally {
      setReverting(false);
    }
  };

  const handleSubmit = async () => {
    if (mode === 'mutual') {
      if (swapDate.isSame(otherSwapDate, 'day')) {
        message.error('Please pick two different dates');
        return;
      }
      try {
        setSubmitting(true);
        await createMutualSwap(swapDate.format('YYYY-MM-DD'), otherSwapDate.format('YYYY-MM-DD'));
        message.success('Homes swapped for both dates');
        setModalOpen(false);
        loadAssignment();
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to save changes');
      } finally {
        setSubmitting(false);
      }
      return;
    }

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
            <MemberAvatar
              key={assignment.member.unique_id}
              uniqueId={assignment.member.unique_id}
              size={56}
              className="today-assignment-avatar"
            />
            <div className="today-assignment-info">
              <div className="today-assignment-heading">
                <span className="today-assignment-label">Food Today</span>
                {assignment.swapped && <Tag color="orange">Swapped</Tag>}
              </div>
              <div className="today-assignment-name">{assignment.member.name}</div>
              {assignment.member.phone && (
                <a
                  href={`tel:${assignment.member.phone.replace(/\s+/g, '')}`}
                  className="today-assignment-phone"
                >
                  <PhoneOutlined /> {assignment.member.phone}
                </a>
              )}
              {assignment.swapped && assignment.originalMember && (
                <div className="today-assignment-original">
                  Originally: {assignment.originalMember.name}
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="today-assignment-actions">
                {assignment.swapped && (
                  <Tooltip title="Revert to original home">
                    <Button
                      icon={<UndoOutlined />}
                      shape="circle"
                      size="large"
                      onClick={handleRevert}
                      loading={reverting}
                      className="today-assignment-swap-btn"
                    />
                  </Tooltip>
                )}
                <Tooltip title="Swap or set today's home">
                  <Button
                    icon={<SwapOutlined />}
                    shape="circle"
                    size="large"
                    onClick={openModal}
                    className="today-assignment-swap-btn"
                  />
                </Tooltip>
              </div>
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
              { label: 'Swap two dates with each other', value: 'mutual' },
              {
                label: (
                  <Tooltip title="Coming soon - reserved for super admin">
                    Set as current & continue from here
                  </Tooltip>
                ),
                value: 'set-current',
                disabled: true,
              },
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
                disabledDate={(current) => current && current < masjidTodayDayjs().startOf('day')}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {mode === 'mutual' && (
            <>
              <div>
                <div className="swap-modal-field-label">First date</div>
                <DatePicker
                  value={swapDate}
                  onChange={(d) => d && setSwapDate(d)}
                  format="YYYY-MM-DD"
                  disabledDate={(current) => current && current < masjidTodayDayjs().startOf('day')}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div className="swap-modal-field-label">Second date</div>
                <DatePicker
                  value={otherSwapDate}
                  onChange={(d) => d && setOtherSwapDate(d)}
                  format="YYYY-MM-DD"
                  disabledDate={(current) => current && current < masjidTodayDayjs().startOf('day')}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {mode !== 'mutual' && (
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
          )}

          <div className="swap-modal-hint">
            {mode === 'swap'
              ? "To swap two homes, save this once for each home's date."
              : mode === 'mutual'
                ? 'Whoever is currently assigned to each date trades places with the other - no need to pick homes.'
                : 'This home takes over today, and the rotation continues in normal order from them onward - the rest of the current cycle is replaced.'}
          </div>
        </Space>
      </Modal>
    </>
  );
}
