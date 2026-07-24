import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Table, Button, Alert, Spin, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TableRef } from 'antd/es/table';
import { getYearlySchedule, getMasjidToday, type YearlyScheduleMember } from '../../services/api';
import './YearlyScheduleView.css';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function YearlyScheduleView() {
  const [year, setYear] = useState(() => getMasjidToday().year);
  const [members, setMembers] = useState<YearlyScheduleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<TableRef>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getYearlySchedule(year);
        setMembers(data.members);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load yearly schedule');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year]);

  const today = getMasjidToday();
  const isCurrentYear = year === today.year;
  const currentMonthIndex = today.monthIndex;
  const currentDay = today.day;

  const isTodayRow = (record: YearlyScheduleMember) =>
    isCurrentYear &&
    record.months[currentMonthIndex].some((entry) => entry.day === currentDay && entry.swapped !== 'away');

  // Scroll today's home into view once the schedule loads, so landing here
  // (e.g. from the Dashboard's "Food Today" card) doesn't leave the user
  // hunting through the member list for the already-highlighted row.
  useEffect(() => {
    if (!members.length || !isCurrentYear) return;
    const todayRecord = members.find(isTodayRow);
    if (!todayRecord) return;
    const timer = setTimeout(() => {
      tableRef.current?.scrollTo({ key: todayRecord.id });
    }, 50);
    return () => clearTimeout(timer);
  }, [members, isCurrentYear]);

  const columns: ColumnsType<YearlyScheduleMember> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      fixed: 'left',
      ellipsis: true,
    },
    ...MONTH_LABELS.map((label, i) => ({
      title: label,
      key: label,
      width: 80,
      align: 'center' as const,
      render: (_: unknown, record: YearlyScheduleMember) => {
        const entries = record.months[i];
        if (entries.length === 0) return '-';

        const nodes = entries.map((entry) => {
          const isToday = isCurrentYear && i === currentMonthIndex && entry.day === currentDay;
          const className =
            entry.swapped === 'away'
              ? 'yearly-schedule-swapped-away'
              : entry.swapped === 'in'
                ? 'yearly-schedule-swapped-in'
                : isToday
                  ? 'yearly-schedule-today-badge'
                  : undefined;
          const inner = <span className={className}>{entry.day}</span>;

          if (!entry.swapped) {
            return <span key={entry.day}>{inner}</span>;
          }

          const tooltipText = entry.otherMemberName
            ? entry.swapped === 'away'
              ? `Swapped to ${entry.otherMemberName}`
              : `Swapped from ${entry.otherMemberName}`
            : entry.swapped === 'away'
              ? 'Swapped away'
              : 'Swapped in';

          return (
            <Tooltip key={`${entry.day}-${entry.swapped}`} title={tooltipText}>
              {inner}
            </Tooltip>
          );
        });

        return nodes.reduce(
          (acc, el, idx) => (idx === 0 ? [el] : [...acc, ', ', el]),
          [] as ReactNode[]
        );
      },
    })),
  ];

  return (
    <div className="yearly-schedule-container">
      <div className="yearly-schedule-header">
        <h1 className="yearly-schedule-title">📅 Yearly Schedule</h1>
        <div className="yearly-schedule-year-nav">
          <Button icon={<LeftOutlined />} onClick={() => setYear((y) => y - 1)} />
          <span className="yearly-schedule-year">{year}</span>
          <Button icon={<RightOutlined />} onClick={() => setYear((y) => y + 1)} />
        </div>
      </div>

      {error && (
        <Alert
          message="Error Loading Schedule"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      {loading ? (
        <div className="yearly-schedule-loading">
          <Spin size="large" />
        </div>
      ) : (
        <Table
          ref={tableRef}
          columns={columns}
          dataSource={members}
          rowKey="id"
          pagination={false}
          className="yearly-schedule-table"
          scroll={{ x: 'max-content' }}
          rowClassName={(record) => (isTodayRow(record) ? 'yearly-schedule-today-row' : '')}
        />
      )}
    </div>
  );
}
