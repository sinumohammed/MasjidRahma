import { useEffect, useMemo, useState } from 'react';
import { Segmented, Spin, Alert, Empty } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import dayjs, { type Dayjs } from 'dayjs';
import { getTransactions, getMasjidToday, type Transaction } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { money } from '../utils/money';
import './ChartsPanel.css';

// The admin's "Money" section under the stat tiles: each chart answers one
// question, with the answer written above it.
//   - Month by month: did more come in or go out, each month? Income and
//     expenses as paired bars - one money scale, one axis.
//   - Where the money goes / comes from: each category's amount and share,
//     largest first; a row opens its transactions.
// Colours: money in emerald, money out gold (--m-chart-in / --m-chart-out) -
// green against red is hard to tell apart with red-green colour blindness.

type Period = 'year' | '12m' | 'all';
// Money carried over when the books started, recorded as income: not money
// received, so it is left out of these charts (it was a third of "income"
// and the tallest bar) and named under "Where it comes from".
const isOpeningBalance = (t: Transaction) => /^opening balance$/i.test(t.category.trim());
const TOP_CATEGORIES = 6;
const MAX_MONTHS = 24;

interface MonthPoint {
  key: string; // YYYY-MM
  label: string;
  income: number;
  expense: number;
}

interface CategoryRow {
  category: string;
  total: number;
  share: number;
  other?: boolean;
}

// ₹1.2L, ₹45K - short amounts for an axis.
const compact = (n: number) =>
  n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n >= 1000 ? `${+(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(Math.round(n));

function periodStart(period: Period): Dayjs | null {
  const today = dayjs(getMasjidToday().dateString);
  if (period === 'year') return today.startOf('year');
  if (period === '12m') return today.subtract(11, 'month').startOf('month');
  return null;
}

function byCategory(transactions: Transaction[], type: 'income' | 'expense'): CategoryRow[] {
  const totals = new Map<string, number>();
  for (const t of transactions) if (t.type === type) totals.set(t.category, (totals.get(t.category) ?? 0) + Number(t.amount));
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((s, [, v]) => s + v, 0);
  if (!sum) return [];
  const rows: CategoryRow[] = sorted.slice(0, TOP_CATEGORIES).map(([category, total]) => ({ category, total, share: total / sum }));
  const rest = sorted.slice(TOP_CATEGORIES);
  if (rest.length) {
    const total = rest.reduce((s, [, v]) => s + v, 0);
    rows.push({ category: `${rest.length} other categories`, total, share: total / sum, other: true });
  }
  return rows;
}

function byMonth(transactions: Transaction[], start: Dayjs | null): MonthPoint[] {
  const today = dayjs(getMasjidToday().dateString);
  const first = start ?? transactions.reduce<Dayjs | null>((min, t) => (min && min.isBefore(dayjs(t.date)) ? min : dayjs(t.date)), null);
  if (!first) return [];
  const months: MonthPoint[] = [];
  for (let m = first.startOf('month'); !m.isAfter(today, 'month'); m = m.add(1, 'month')) {
    months.push({ key: m.format('YYYY-MM'), label: m.format('MMM'), income: 0, expense: 0 });
  }
  const index = new Map(months.map((m, i) => [m.key, i]));
  for (const t of transactions) {
    const i = index.get(dayjs(t.date).format('YYYY-MM'));
    if (i === undefined) continue;
    if (t.type === 'income') months[i].income += Number(t.amount);
    else months[i].expense += Number(t.amount);
  }
  // Months spanning two years: "Jan '26".
  const years = new Set(months.map((m) => m.key.slice(0, 4)));
  if (years.size > 1) for (const m of months) m.label = dayjs(`${m.key}-01`).format("MMM 'YY");
  return months.slice(-MAX_MONTHS);
}

function MonthTooltip({ active, payload, currencySymbol }: { active?: boolean; payload?: { payload: MonthPoint }[]; currencySymbol: string }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  const net = m.income - m.expense;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{dayjs(`${m.key}-01`).format('MMMM YYYY')}</div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-key" style={{ background: 'var(--m-chart-in)' }} />
        <span className="chart-tooltip-name">In</span>
        <span className="chart-tooltip-value">
          {currencySymbol}
          {money(m.income)}
        </span>
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-key" style={{ background: 'var(--m-chart-out)' }} />
        <span className="chart-tooltip-name">Out</span>
        <span className="chart-tooltip-value">
          {currencySymbol}
          {money(m.expense)}
        </span>
      </div>
      <div className="chart-tooltip-row chart-tooltip-net">
        <span className="chart-tooltip-name">{net >= 0 ? 'Saved' : 'Overspent'}</span>
        <span className="chart-tooltip-value">
          {currencySymbol}
          {money(Math.abs(net))}
        </span>
      </div>
    </div>
  );
}

function CategoryBars({
  rows,
  tone,
  currencySymbol,
  onOpen,
}: {
  rows: CategoryRow[];
  tone: 'in' | 'out';
  currencySymbol: string;
  onOpen?: (category: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <ol className="money-cats">
      {rows.map((r) => {
        const open = !r.other && onOpen ? () => onOpen(r.category) : undefined;
        return (
          <li key={r.category}>
            <button type="button" className="money-cat" onClick={open} disabled={!open} title={open ? `See the ${r.category} transactions` : undefined}>
              <span className="money-cat-text">
                <span className="money-cat-name">{r.category}</span>
                <span className="money-cat-amount">
                  {currencySymbol}
                  {money(r.total)}
                  <span className="money-cat-share">{Math.round(r.share * 100)}%</span>
                </span>
              </span>
              <span className="money-cat-track">
                <span className={`money-cat-bar is-${tone}`} style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

interface ChartsPanelProps {
  // A category row opens its transactions (Dashboard -> Transactions page).
  onOpenCategory?: (type: 'income' | 'expense', category: string) => void;
}

export default function ChartsPanel({ onOpenCategory }: ChartsPanelProps) {
  const { currencySymbol } = useSettings();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('12m');

  useEffect(() => {
    getTransactions()
      .then(setTransactions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the figures'))
      .finally(() => setLoading(false));
  }, []);

  const { months, out, into, carriedOver } = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = start ? transactions.filter((t) => !dayjs(t.date).isBefore(start, 'day')) : transactions;
    const counted = inPeriod.filter((t) => !isOpeningBalance(t));
    const carriedOver = inPeriod.filter(isOpeningBalance).reduce((sum, t) => sum + Number(t.amount), 0);
    return { months: byMonth(counted, start), out: byCategory(counted, 'expense'), into: byCategory(counted, 'income'), carriedOver };
  }, [transactions, period]);
  const totalIn = months.reduce((s, m) => s + m.income, 0);
  const totalOut = months.reduce((s, m) => s + m.expense, 0);

  if (loading) {
    return (
      <div className="charts-loading">
        <Spin size="large" />
      </div>
    );
  }
  if (error) return <Alert message="Could not load the figures" description={error} type="error" showIcon />;

  const latest = [...months].reverse().find((m) => m.income || m.expense);
  const latestNet = latest ? latest.income - latest.expense : 0;
  const isCurrentMonth = latest?.key === dayjs(getMasjidToday().dateString).format('YYYY-MM');
  const periodLabel = period === 'year' ? 'this year' : period === '12m' ? 'in the last 12 months' : 'in all';
  const rupees = (n: number) => `${currencySymbol}${money(n)}`;

  return (
    <section className="money">
      <div className="money-head">
        <h2 className="dashboard-section-title">Money</h2>
        <Segmented
          value={period}
          onChange={(v) => setPeriod(v as Period)}
          options={[
            { label: 'This year', value: 'year' },
            { label: 'Last 12 months', value: '12m' },
            { label: 'All time', value: 'all' },
          ]}
        />
      </div>

      <div className="money-card money-months">
        <div className="money-card-head">
          <div>
            <h3>Month by month</h3>
            {latest ? (
              <p className="money-headline">
                {dayjs(`${latest.key}-01`).format('MMMM')}
                {isCurrentMonth ? ' so far' : ''}: <b>{rupees(latest.income)}</b> in, <b>{rupees(latest.expense)}</b> out -{' '}
                {latestNet >= 0 ? `${rupees(latestNet)} more came in than went out.` : `${rupees(-latestNet)} more went out than came in.`}
              </p>
            ) : (
              <p className="money-headline">Nothing recorded {periodLabel}.</p>
            )}
          </div>
          <div className="money-legend" aria-label="Legend">
            <span>
              <i className="is-in" /> In <b>{rupees(totalIn)}</b>
            </span>
            <span>
              <i className="is-out" /> Out <b>{rupees(totalOut)}</b>
            </span>
          </div>
        </div>
        {months.length === 0 ? (
          <Empty description="No transactions in this period" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--m-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--m-border)' }} tick={{ fill: 'var(--m-muted)', fontSize: 12 }} interval="preserveStartEnd" minTickGap={6} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--m-muted)', fontSize: 12 }} tickFormatter={(v) => `${currencySymbol}${compact(Number(v))}`} width={52} />
              <Tooltip content={<MonthTooltip currencySymbol={currencySymbol} />} cursor={{ fill: 'var(--m-primary-soft)' }} />
              <Bar dataKey="income" name="In" fill="var(--m-chart-in)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="expense" name="Out" fill="var(--m-chart-out)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="money-pair">
        <div className="money-card">
          <div className="money-card-head">
            <div>
              <h3>Where the money goes</h3>
              <p className="money-headline">
                {out.length ? (
                  <>
                    <b>{out[0].category}</b> takes {Math.round(out[0].share * 100)}% of the {rupees(totalOut)} spent {periodLabel}.
                  </>
                ) : (
                  `Nothing spent ${periodLabel}.`
                )}
              </p>
            </div>
          </div>
          {out.length > 0 && <CategoryBars rows={out} tone="out" currencySymbol={currencySymbol} onOpen={onOpenCategory && ((c) => onOpenCategory('expense', c))} />}
        </div>

        <div className="money-card">
          <div className="money-card-head">
            <div>
              <h3>Where it comes from</h3>
              <p className="money-headline">
                {into.length ? (
                  <>
                    <b>{into[0].category}</b> brings {Math.round(into[0].share * 100)}% of the {rupees(totalIn)} received {periodLabel}.
                  </>
                ) : (
                  `Nothing received ${periodLabel}.`
                )}
              </p>
            </div>
          </div>
          {into.length > 0 && <CategoryBars rows={into} tone="in" currencySymbol={currencySymbol} onOpen={onOpenCategory && ((c) => onOpenCategory('income', c))} />}
          {carriedOver > 0 && (
            <p className="money-note">
              Not counted: opening balances, {rupees(carriedOver)} - money carried over when the books started, not money received.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
