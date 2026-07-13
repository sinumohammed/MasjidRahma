import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Spin, Alert, Empty } from 'antd';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import dayjs from 'dayjs';
import { getCategoryStats, getTransactions, type CategoryStat, type DateRangeParams, type Transaction } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import './ChartsPanel.css';

// Categorical palette, fixed order (validated for CVD safety) — never reassigned by rank.
const CATEGORY_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];

const INCOME_COLOR = '#52c41a';
const EXPENSE_COLOR = '#f5222d';
const MAX_CATEGORY_SLICES = 7;

interface TrendPoint {
  date: string;
  income: number;
  expense: number;
}

function buildCategoryData(stats: CategoryStat[]) {
  const expenseStats = stats
    .filter((s) => s.type === 'expense')
    .sort((a, b) => b.total - a.total);

  if (expenseStats.length <= MAX_CATEGORY_SLICES) {
    return expenseStats.map((s) => ({ category: s.category, total: s.total }));
  }

  const top = expenseStats.slice(0, MAX_CATEGORY_SLICES);
  const rest = expenseStats.slice(MAX_CATEGORY_SLICES);
  const otherTotal = rest.reduce((sum, s) => sum + s.total, 0);
  return [...top.map((s) => ({ category: s.category, total: s.total })), { category: 'Other', total: otherTotal }];
}

function buildTrendData(transactions: Transaction[]): TrendPoint[] {
  const byDate = new Map<string, TrendPoint>();
  for (const t of transactions) {
    const key = dayjs(t.date).format('YYYY-MM-DD');
    if (!byDate.has(key)) {
      byDate.set(key, { date: key, income: 0, expense: 0 });
    }
    const point = byDate.get(key)!;
    if (t.type === 'income') point.income += t.amount;
    else point.expense += t.amount;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function CustomTooltip({ active, payload, label, currencySymbol }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label && <div className="chart-tooltip-label">{dayjs(label).isValid() && /^\d{4}-\d{2}-\d{2}$/.test(label) ? dayjs(label).format('MMM D, YYYY') : label}</div>}
      {payload.map((entry: any) => (
        <div key={entry.dataKey ?? entry.name} className="chart-tooltip-row">
          <span className="chart-tooltip-key" style={{ background: entry.color }} />
          <span className="chart-tooltip-name">{entry.name}</span>
          <span className="chart-tooltip-value">
            {currencySymbol}{Number(entry.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ))}
    </div>
  );
}

interface ChartsPanelProps {
  dateRange?: DateRangeParams;
}

export default function ChartsPanel({ dateRange }: ChartsPanelProps) {
  const { currencySymbol } = useSettings();
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [stats, txns] = await Promise.all([getCategoryStats(dateRange), getTransactions(dateRange)]);
        setCategoryStats(stats);
        setTransactions(txns);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [dateRange?.startDate, dateRange?.endDate]);

  const categoryData = useMemo(() => buildCategoryData(categoryStats), [categoryStats]);
  const trendData = useMemo(() => buildTrendData(transactions), [transactions]);

  if (loading) {
    return (
      <div className="charts-loading">
        <Spin size="large" tip="Loading charts..." />
      </div>
    );
  }

  if (error) {
    return <Alert message="Error Loading Charts" description={error} type="error" showIcon style={{ marginTop: 24 }} />;
  }

  return (
    <Row gutter={[24, 24]} className="charts-panel" style={{ marginTop: 40 }}>
      <Col xs={24} lg={11}>
        <Card title="🧾 Expenses by Category" className="chart-card" bordered={false}>
          {categoryData.length === 0 ? (
            <Empty description="No expense data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, categoryData.length * 44)}>
              <BarChart data={categoryData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid horizontal={false} stroke="#e1e0d9" />
                <XAxis type="number" tickFormatter={(v) => `${currencySymbol}${v.toLocaleString()}`} stroke="#898781" fontSize={12} />
                <YAxis type="category" dataKey="category" stroke="#898781" fontSize={12} width={110} />
                <Tooltip content={<CustomTooltip currencySymbol={currencySymbol} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="total" name="Expense" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {categoryData.map((entry, index) => (
                    <Cell key={entry.category} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Col>

      <Col xs={24} lg={13}>
        <Card title="📈 Income vs Expense Trend" className="chart-card" bordered={false}>
          {trendData.length === 0 ? (
            <Empty description="No transaction data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e1e0d9" />
                <XAxis
                  dataKey="date"
                  stroke="#898781"
                  fontSize={12}
                  tickFormatter={(v) => dayjs(v).format('MMM D')}
                />
                <YAxis stroke="#898781" fontSize={12} tickFormatter={(v) => `${currencySymbol}${v.toLocaleString()}`} />
                <Tooltip content={<CustomTooltip currencySymbol={currencySymbol} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey="income" name="Income" stroke={INCOME_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="expense" name="Expense" stroke={EXPENSE_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Col>
    </Row>
  );
}
