// Parsing an assistant answer into lines, Markdown tables and ```chart blocks
// (shown by AssistantAnswer.tsx). Kept apart from the component so the file
// with the component exports components only.

export type Block =
  | { kind: 'line'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'chart'; chart: ChartSpec };

// One series ("value") or several named ones ("series": ["Income", "Expense"],
// each data item carrying a number per name) - income vs expense by month.
export interface ChartSpec {
  type: 'bar' | 'pie' | 'line';
  title?: string;
  unit?: string;
  series: string[];
  data: ({ label: string } & Record<string, number | string>)[];
}

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
export const NUMBER = /^[-+]?\s*[₹$]?\s*[\d,]+(\.\d+)?\s*%?$/;
export const TOTAL = /^(total|grand total|ആകെ|മൊത്തം)/i;
export const CHART_COLORS = ['#0f6b52', '#b07d1c', '#2f6aa3', '#be3455', '#2a9d8f', '#6a4fb3', '#65a30d', '#db2777'];

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// A chart block the screen can trust: known type, 1-31 items (a month by day), 1-4 series
// (a pie: one), numbers as numbers - a missing one in a named series is 0.
// Anything else is dropped - its figures are in the table anyway.
function parseChart(json: string): ChartSpec | null {
  try {
    const c = JSON.parse(json);
    if (!['bar', 'pie', 'line'].includes(c?.type) || !Array.isArray(c.data) || !c.data.length || c.data.length > 31) return null;
    // No "series" but items like { label, Income, Expense } (gpt-oss wrote
    // that): the names are the first item's other keys.
    const keys = c.data[0] && typeof c.data[0] === 'object' ? Object.keys(c.data[0]).filter((k) => k !== 'label') : [];
    const inferred = !Array.isArray(c.series) && !keys.includes('value') && keys.length > 0 ? keys : null;
    const named = (Array.isArray(c.series) && c.series.length > 0) || Boolean(inferred);
    const series: string[] = inferred ?? (named ? c.series.map((n: unknown) => String(n ?? '').trim()) : ['value']);
    if (series.length > 4 || series.some((n) => !n || n === 'label') || new Set(series).size !== series.length) return null;
    if (c.type === 'pie' && series.length > 1) return null;
    const data = c.data.map((d: Record<string, unknown>) => {
      const row: { label: string } & Record<string, number | string> = { label: String(d?.label ?? '').trim() };
      for (const n of series) row[n] = named && d?.[n] === undefined ? 0 : Number(d?.[n]);
      return row;
    });
    if (data.some((d: Record<string, number | string>) => !d.label || series.some((n) => !Number.isFinite(d[n])))) return null;
    return { type: c.type, title: typeof c.title === 'string' ? c.title : undefined, unit: typeof c.unit === 'string' ? c.unit : undefined, series, data };
  } catch {
    return null;
  }
}

export function parseAnswer(text: string): Block[] {
  const lines = text.replace(/\s*(\[\d+\]|【\d+】)/g, '').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```\s*chart\s*$/i.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      const chart = parseChart(body.join('\n'));
      if (chart) blocks.push({ kind: 'chart', chart });
      continue;
    }
    if (TABLE_LINE.test(line) && SEPARATOR.test(lines[i + 1] ?? '')) {
      const header = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && TABLE_LINE.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (/^\s*```/.test(line)) continue; // a stray fence
    blocks.push({ kind: 'line', text: line });
  }
  return blocks;
}

export const isWideAnswer = (text: string) => parseAnswer(text).some((b) => b.kind !== 'line');

// An answer to copy: plain text (tables tab-separated, so they paste into a
// spreadsheet as columns) and HTML (a real table, for Word, Gmail, Docs).
// A chart is left out - its figures are in the table next to it.
const plainLine = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[-*]\s+/, '• ');
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function answerAsText(text: string): string {
  return parseAnswer(text)
    .flatMap((b) => (b.kind === 'line' ? [plainLine(b.text)] : b.kind === 'table' ? [b.header, ...b.rows].map((r) => r.map(plainLine).join('\t')) : []))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function answerAsHtml(text: string): string {
  const cell = (tag: string, s: string) => `<${tag} style="border:1px solid #ccc;padding:4px 8px;text-align:left">${escapeHtml(plainLine(s))}</${tag}>`;
  return parseAnswer(text)
    .map((b) =>
      b.kind === 'line'
        ? b.text.trim() ? `<p>${escapeHtml(plainLine(b.text))}</p>` : ''
        : b.kind === 'table'
          ? `<table style="border-collapse:collapse"><tr>${b.header.map((h) => cell('th', h)).join('')}</tr>${b.rows.map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('')}</table>`
          : ''
    )
    .join('');
}
