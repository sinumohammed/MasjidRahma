import { useEffect, useState } from 'react';
import { Card, Tag, Button, Modal, Select, DatePicker, Radio, Space, Input, message, Spin, Tooltip } from 'antd';
import { SwapOutlined, PhoneOutlined, UndoOutlined, CalendarOutlined, BellOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import {
  getTodayAssignment,
  getSchedule,
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
import { buildGoogleCalendarUrl, downloadIcsReminder } from '../../utils/calendar';
import MemberAvatar from './MemberAvatar';
import './TodayAssignmentCard.css';

// The masjid's "today" (Asia/Kolkata), not the browser's local "today" - a
// swap saved under the browser's local date can silently miss the date the
// backend/dashboard actually treat as today when they differ.
const masjidTodayDayjs = () => dayjs(getMasjidToday().dateString);

type ModalMode = 'swap' | 'mutual' | 'set-current';

// How far ahead to look for a member's own next turn - comfortably covers
// typical rotation cycle lengths (number of active members).
const NEXT_TURN_LOOKAHEAD_DAYS = 60;

interface TodayAssignmentCardProps {
  onOpenYearlySchedule?: () => void;
}

export default function TodayAssignmentCard({ onOpenYearlySchedule }: TodayAssignmentCardProps) {
  const { isAdmin, isLoggedIn, memberId } = useAuth();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tomorrowAssignment, setTomorrowAssignment] = useState<Assignment | null>(null);
  const [myNextTurn, setMyNextTurn] = useState<Assignment | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('swap');
  const [members, setMembers] = useState<Member[]>([]);
  const [swapDate, setSwapDate] = useState<Dayjs>(masjidTodayDayjs());
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>();
  const [otherSwapDate, setOtherSwapDate] = useState<Dayjs>(masjidTodayDayjs());
  const [submitting, setSubmitting] = useState(false);
  const [reverting, setReverting] = useState(false);

  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderSubject, setReminderSubject] = useState('മസ്ജിദ് ഭക്ഷണ ദിനം - നിങ്ങളുടെ ഊഴം');
  const [reminderDate, setReminderDate] = useState<Dayjs>(masjidTodayDayjs());

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

  const loadUpcoming = async () => {
    try {
      if (isAdmin) {
        const schedule = await getSchedule(2);
        setTomorrowAssignment(schedule[1] ?? null);
      } else if (isLoggedIn && memberId) {
        const schedule = await getSchedule(NEXT_TURN_LOOKAHEAD_DAYS);
        const upcoming = schedule.find((a, idx) => idx > 0 && a.member?.id === memberId);
        setMyNextTurn(upcoming ?? null);
      }
    } catch {
      // Non-critical supplementary info - fail silently, keep today's card usable.
    }
  };

  useEffect(() => {
    loadAssignment();
    loadUpcoming();
    const interval = setInterval(() => {
      loadAssignment();
      loadUpcoming();
    }, 300000);
    return () => clearInterval(interval);
  }, [isAdmin, isLoggedIn, memberId]);

  const openModal = async () => {
    setMode('swap');
    setSwapDate(masjidTodayDayjs());
    setOtherSwapDate(masjidTodayDayjs().add(1, 'day'));
    setSelectedMemberId(undefined);
    setModalOpen(true);
    try {
      const data = await getMembers();
      setMembers(data.filter((m) => m.active && m.member_type === 'regular'));
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

  const openReminderModal = () => {
    if (!myNextTurn) return;
    setReminderSubject('മസ്ജിദ് ഭക്ഷണ ദിനം - നിങ്ങളുടെ ഊഴം');
    setReminderDate(dayjs(myNextTurn.date));
    setReminderModalOpen(true);
  };

  const handleAddToGoogleCalendar = () => {
    const url = buildGoogleCalendarUrl({
      title: reminderSubject || 'മസ്ജിദ് ഭക്ഷണ ദിനം',
      description: 'മസ്ജിദ് റഹ്മയിൽ നിന്നുള്ള ഭക്ഷണ ചുമതല ഓർമ്മപ്പെടുത്തൽ.',
      date: reminderDate.format('YYYY-MM-DD'),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadIcs = () => {
    downloadIcsReminder({
      title: reminderSubject || 'മസ്ജിദ് ഭക്ഷണ ദിനം',
      description: 'മസ്ജിദ് റഹ്മയിൽ നിന്നുള്ള ഭക്ഷണ ചുമതല ഓർമ്മപ്പെടുത്തൽ.',
      date: reminderDate.format('YYYY-MM-DD'),
    });
    message.success('കലണ്ടർ ഫയൽ ഡൗൺലോഡ് ചെയ്തു');
  };

  const isMyTurnToday = !isAdmin && isLoggedIn && !!memberId && assignment?.member?.id === memberId;
  const showSidePanel = isAdmin || (isLoggedIn && !!memberId);

  return (
    <>
      <Card
        className={`today-assignment-card${isMyTurnToday ? ' my-turn' : ''}${onOpenYearlySchedule ? ' clickable' : ''}${isAdmin ? ' has-actions' : ''}`}
        variant="borderless"
        onClick={onOpenYearlySchedule}
      >
        {loading ? (
          <Spin />
        ) : error ? (
          <div className="today-assignment-error">{error}</div>
        ) : !assignment?.member ? (
          <div className="today-assignment-empty">സജീവ അംഗങ്ങളൊന്നും ഇതുവരെ സജ്ജീകരിച്ചിട്ടില്ല.</div>
        ) : (
          <div className={`today-assignment-split${isAdmin ? ' has-actions' : ''}`}>
            <div className="today-assignment-main">
              <MemberAvatar
                key={assignment.member.unique_id}
                uniqueId={assignment.member.unique_id}
                size={64}
                className="today-assignment-avatar"
              />
              <div className="today-assignment-info">
                <div className="today-assignment-heading">
                  <span className="today-assignment-label">ഇന്നത്തെ ഭക്ഷണം</span>
                  {assignment.swapped && <Tag color="orange">മാറ്റം വരുത്തി</Tag>}
                  {isMyTurnToday && <Tag color="green">നിങ്ങളുടെ ഊഴം!</Tag>}
                </div>
                <div className="today-assignment-name">{assignment.member.name}</div>
                {assignment.member.phone && (
                  <a
                    href={`tel:${assignment.member.phone.replace(/\s+/g, '')}`}
                    className="today-assignment-phone"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <PhoneOutlined /> {assignment.member.phone}
                  </a>
                )}
                {assignment.swapped && assignment.originalMember && (
                  <div className="today-assignment-original">
                    യഥാർത്ഥത്തിൽ: {assignment.originalMember.name}
                  </div>
                )}
              </div>
            </div>

            {showSidePanel && (
              <div className="today-assignment-side">
                {isAdmin ? (
                  tomorrowAssignment?.member ? (
                    <>
                      <div className="today-assignment-side-label">
                        <CalendarOutlined /> അടുത്തത്
                      </div>
                      <div className="today-assignment-side-name">
                        {tomorrowAssignment.member.name}
                      </div>
                      <div className="today-assignment-side-desc">
                        നാളത്തെ ഭക്ഷണ ചുമതലയ്ക്കായി ഷെഡ്യൂൾ ചെയ്തിരിക്കുന്നു.
                      </div>
                    </>
                  ) : (
                    <div className="today-assignment-side-empty">
                      നാളത്തെ വീട് ഇതുവരെ നിശ്ചയിച്ചിട്ടില്ല.
                    </div>
                  )
                ) : isMyTurnToday ? (
                  <>
                    <div className="today-assignment-side-label">
                      <CalendarOutlined /> ഇന്ന്
                    </div>
                    <div className="today-assignment-side-desc">
                      ഇന്ന് ഭക്ഷണം നൽകേണ്ടത് നിങ്ങളുടെ ഊഴമാണ് - നന്ദി!
                    </div>
                  </>
                ) : myNextTurn?.member ? (
                  <div
                    className="today-assignment-side-content clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      openReminderModal();
                    }}
                  >
                    <div className="today-assignment-side-label">
                      <CalendarOutlined /> നിങ്ങളുടെ ഊഴം
                    </div>
                    <div className="today-assignment-side-name">
                      {dayjs(myNextTurn.date).format('ddd, MMM D')}
                    </div>
                    <div className="today-assignment-side-desc">
                      നിങ്ങളുടെ അടുത്ത ഊഴത്തിന് ഓർമ്മപ്പെടുത്തൽ സജ്ജമാക്കാൻ ടാപ്പ് ചെയ്യുക.
                    </div>
                  </div>
                ) : (
                  <div className="today-assignment-side-empty">
                    അടുത്ത {NEXT_TURN_LOOKAHEAD_DAYS} ദിവസത്തിനുള്ളിൽ വരാനിരിക്കുന്ന ഊഴം കണ്ടെത്തിയില്ല.
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="today-assignment-actions" onClick={(e) => e.stopPropagation()}>
                {assignment.swapped && (
                  <Tooltip title="യഥാർത്ഥ വീട്ടിലേക്ക് തിരികെ മാറ്റുക">
                    <Button
                      icon={<UndoOutlined />}
                      shape="circle"
                      size="small"
                      onClick={handleRevert}
                      loading={reverting}
                      className="today-assignment-swap-btn"
                    />
                  </Tooltip>
                )}
                <Tooltip title="ഇന്നത്തെ വീട് മാറ്റുക അല്ലെങ്കിൽ സജ്ജമാക്കുക">
                  <Button
                    icon={<SwapOutlined />}
                    shape="circle"
                    size="small"
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

      <Modal
        title="ഓർമ്മപ്പെടുത്തൽ സജ്ജമാക്കുക"
        open={reminderModalOpen}
        onCancel={() => setReminderModalOpen(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div className="swap-modal-field-label">വിഷയം</div>
            <Input
              value={reminderSubject}
              onChange={(e) => setReminderSubject(e.target.value)}
              placeholder="ഓർമ്മപ്പെടുത്തലിന്റെ വിഷയം"
            />
          </div>
          <div>
            <div className="swap-modal-field-label">തീയതി</div>
            <DatePicker
              value={reminderDate}
              onChange={(d) => d && setReminderDate(d)}
              format="YYYY-MM-DD"
              style={{ width: '100%' }}
            />
          </div>
          <Space wrap>
            <Button type="primary" icon={<CalendarOutlined />} onClick={handleAddToGoogleCalendar}>
              Google കലണ്ടറിൽ ചേർക്കുക
            </Button>
            <Button icon={<BellOutlined />} onClick={handleDownloadIcs}>
              .ics ഡൗൺലോഡ് ചെയ്യുക
            </Button>
          </Space>
          <div className="swap-modal-hint">
            ഇത് നിങ്ങളുടെ കലണ്ടർ ആപ്പിൽ ഒരു ദിവസത്തെ ഇവന്റ് ചേർക്കും; യഥാർത്ഥ ഓർമ്മപ്പെടുത്തൽ/അറിയിപ്പ് കലണ്ടർ ആപ്പ് തന്നെ കൈകാര്യം ചെയ്യും.
          </div>
        </Space>
      </Modal>
    </>
  );
}
