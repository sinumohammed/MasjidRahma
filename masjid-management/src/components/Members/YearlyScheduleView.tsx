import { useEffect, useState, type ReactNode } from 'react';
import { Table, Button, Alert, Spin } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getYearlySchedule, type YearlyScheduleMember } from '../../services/api';
import './YearlyScheduleView.css';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function YearlyScheduleView() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [members, setMembers] = useState<YearlyScheduleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const currentDay = now.getDate();

  const isTodayRow = (record: YearlyScheduleMember) =>
    isCurrentYear && record.months[currentMonthIndex].includes(currentDay);

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
        if (record.months[i].length === 0) return '-';
        if (isCurrentYear && i === currentMonthIndex && record.months[i].includes(currentDay)) {
          return record.months[i]
            .map((day) =>
              day === currentDay ? (
                <span key={day} className="yearly-schedule-today-badge">
                  {day}
                </span>
              ) : (
                <span key={day}>{day}</span>
              )
            )
            .reduce((acc, el, idx) => (idx === 0 ? [el] : [...acc, ', ', el]), [] as ReactNode[]);
        }
        return record.months[i].join(', ');
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
