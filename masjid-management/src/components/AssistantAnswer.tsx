import type { ReactNode } from 'react';
import { parseAnswer, CHART_COLORS, NUMBER, TOTAL, type ChartSpec } from './answerFormat';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

// An assistant answer as the AI service writes it for this screen (the masjid
// server asks with display: { tables, charts }):
//   - text lines: "**bold**", bullets ("- " / "* "), numbered lines
//   - Markdown tables: "| Name | Due (₹) |" lines, shown as a real table
//   - a ```chart block with JSON { type: bar|pie|line, title, unit?, data: [{ label, value }] },
//     drawn here; the same figures are in a table next to it
// The AI marks each fact with its source number ("... today [1]."); the source
// is shown once under the answer instead ("From: Masjid records"), so the
// numbers are left out of the text.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part
  );
}

function AnswerTable({ header, rows }: { header: string[]; rows: string[][] }) {
  // A column is numeric when every filled cell in it is a number: right-aligned.
  const numeric = header.map((_, c) => rows.some((r) => r[c]) && rows.every((r) => !r[c] || NUMBER.test(r[c].replace(/\*\*/g, ''))));
  return (
    <div className="assistant-table-wrap">
      <table className="assistant-table">
        <thead>
          <tr>
            {header.map((h, c) => (
              <th key={c} className={numeric[c] ? 'is-num' : undefined}>
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={TOTAL.test((r[0] ?? '').replace(/\*\*/g, '')) ? 'is-total' : undefined}>
              {header.map((_, c) => (
                <td key={c} className={numeric[c] ? 'is-num' : undefined}>
                  {inline(r[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// No grow-in animation: the chat resizes (a new message, the keyboard) and
// recharts would replay it from empty each time.
function AnswerChart({ chart }: { chart: ChartSpec }) {
  const fmt = (v: number) => `${chart.unit === '₹' ? '₹' : ''}${v.toLocaleString('en-IN')}${chart.unit && chart.unit !== '₹' ? ` ${chart.unit}` : ''}`;
  const height = chart.type === 'pie' ? 260 : Math.min(320, 140 + chart.data.length * 14);
  return (
    <figure className="assistant-chart">
      {chart.title && <figcaption>{chart.title}</figcaption>}
      <ResponsiveContainer width="100%" height={height}>
        {chart.type === 'pie' ? (
          <PieChart>
            <Pie isAnimationActive={false} data={chart.data} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
              {chart.data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(name, entry) => `${name} · ${fmt(Number((entry?.payload as { value?: number } | undefined)?.value))}`} />
          </PieChart>
        ) : chart.type === 'line' ? (
          <LineChart data={chart.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--a-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => Number(v).toLocaleString('en-IN')} />
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <Line isAnimationActive={false} type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        ) : (
          <BarChart data={chart.data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--a-border)" />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => Number(v).toLocaleString('en-IN')} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => fmt(Number(v))} cursor={{ fill: 'rgba(15, 107, 82, 0.08)' }} />
            <Bar isAnimationActive={false} dataKey="value" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} barSize={16} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}

export default function AssistantAnswer({ text }: { text: string }) {
  return (
    <>
      {parseAnswer(text).map((b, i) => {
        if (b.kind === 'table') return <AnswerTable key={i} header={b.header} rows={b.rows} />;
        if (b.kind === 'chart') return <AnswerChart key={i} chart={b.chart} />;
        const bullet = /^\s*[-*]\s+/.test(b.text);
        const line = bullet ? b.text.replace(/^\s*[-*]\s+/, '') : b.text;
        return (
          <div key={i} className={bullet ? 'assistant-line assistant-bullet' : /^\s*\d+\.\s/.test(line) ? 'assistant-line assistant-list-line' : 'assistant-line'}>
            {line.trim() ? inline(line) : ' '}
          </div>
        );
      })}
    </>
  );
}
