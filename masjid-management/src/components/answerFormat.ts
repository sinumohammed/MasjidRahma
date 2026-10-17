// Parsing an assistant answer into lines, Markdown tables and ```chart blocks
// (shown by AssistantAnswer.tsx). Kept apart from the component so the file
// with the component exports components only.

export type Block =
  | { kind: 'line'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'chart'; chart: ChartSpec };

export interface ChartSpec {
  type: 'bar' | 'pie' | 'line';
  title?: string;
  unit?: string;
  data: { label: string; value: number }[];
}

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
export const NUMBER = /^[-+]?\s*[₹$]?\s*[\d,]+(\.\d+)?\s*%?$/;
export const TOTAL = /^(total|grand total|ആകെ|മൊത്തം)/i;
export const CHART_COLORS = ['#0f6b52', '#b07d1c', '#2f6aa3', '#be3455', '#2a9d8f', '#6a4fb3', '#65a30d', '#db2777'];

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// A chart block the screen can trust: known type, 1-20 items, numbers as numbers.
// Anything else is dropped - its figures are in the table anyway.
function parseChart(json: string): ChartSpec | null {
  try {
    const c = JSON.parse(json);
    if (!['bar', 'pie', 'line'].includes(c?.type) || !Array.isArray(c.data) || !c.data.length || c.data.length > 20) return null;
    const data = c.data.map((d: { label?: unknown; value?: unknown }) => ({ label: String(d?.label ?? '').trim(), value: Number(d?.value) }));
    if (data.some((d: { label: string; value: number }) => !d.label || !Number.isFinite(d.value))) return null;
    return { type: c.type, title: typeof c.title === 'string' ? c.title : undefined, unit: typeof c.unit === 'string' ? c.unit : undefined, data };
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
