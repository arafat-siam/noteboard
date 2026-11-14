/**
 * Linked monthly planner: a month overview page whose day numbers link to one page per day,
 * and each day page links back to the month. The planner layout is made of locked text boxes
 * and lines, so it can't be moved or erased by accident (long-press to unlock).
 */
import { createNotebookFromPages } from '../db/library';
import { applyStrokeChange } from '../db/pages';
import type { NoteboardDB } from '../db/db';
import { newId, PAGE_HEIGHT, PAGE_WIDTH, type ID, type Notebook, type Stroke, type StrokeLink } from '../model/types';

const LINE = '#c4cdd5';
const INK = '#1c252e';
const MUTED = '#637381';

let order = 1;
function textBox(x: number, y: number, w: number, h: number, content: string, opts: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string; link?: StrokeLink } = {}): Stroke {
  return {
    id: newId(),
    tool: 'text',
    color: opts.color ?? INK,
    size: 0,
    hasPressure: false,
    createdAt: order++,
    locked: true,
    points: [x, y, 0, x + w, y, 0, x + w, y + h, 0, x, y + h, 0],
    text: { content, font: 'sans', size: opts.size ?? 16, width: w, height: h, bold: opts.bold, align: opts.align ?? 'left' },
    ...(opts.link ? { link: opts.link } : {}),
  };
}
function line(x1: number, y1: number, x2: number, y2: number, color = LINE, size = 1.2): Stroke {
  return { id: newId(), tool: 'pen', brush: 'fineliner', color, size, hasPressure: false, createdAt: order++, locked: true, points: [x1, y1, 0.5, x2, y2, 0.5] };
}

/** Monday-first weekday of a date: 0 = Monday … 6 = Sunday. */
const weekday = (d: Date) => (d.getDay() + 6) % 7;

/** The strokes of the month overview page (exported for tests). */
export function monthPage(year: number, month: number, dayPageIds: ID[]): Stroke[] {
  const out: Stroke[] = [];
  const title = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  out.push(textBox(40, 48, 714, 48, title, { size: 34, bold: true }));
  const x0 = 40;
  const y0 = 150;
  const cw = 102;
  const ch = 150;
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  names.forEach((n, i) => out.push(textBox(x0 + i * cw, y0 - 34, cw, 26, n, { size: 14, bold: true, align: 'center', color: MUTED })));
  const first = weekday(new Date(year, month, 1));
  const days = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((first + days) / 7);
  for (let r = 0; r <= rows; r++) out.push(line(x0, y0 + r * ch, x0 + 7 * cw, y0 + r * ch));
  for (let c = 0; c <= 7; c++) out.push(line(x0 + c * cw, y0, x0 + c * cw, y0 + rows * ch));
  for (let d = 1; d <= days; d++) {
    const cell = first + d - 1;
    const x = x0 + (cell % 7) * cw;
    const y = y0 + Math.floor(cell / 7) * ch;
    out.push(textBox(x + 8, y + 6, 40, 26, String(d), { size: 18, bold: true, link: { kind: 'page', pageId: dayPageIds[d - 1]! } }));
  }
  return out;
}

/** The strokes of one day page. */
export function dayPage(date: Date, monthPageId: ID): Stroke[] {
  const out: Stroke[] = [];
  const monthName = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  out.push(textBox(80, 36, 520, 40, date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), { size: 26, bold: true }));
  out.push(textBox(560, 44, 194, 28, `‹ ${monthName}`, { size: 14, align: 'right', color: MUTED, link: { kind: 'page', pageId: monthPageId } }));
  const sections: [string, number][] = [
    ['Priorities', 112],
    ['Schedule', 304],
    ['Notes', 624],
  ];
  for (const [label, y] of sections) {
    out.push(textBox(80, y - 30, 300, 26, label, { size: 15, bold: true, color: MUTED }));
    out.push(line(80, y, 754, y, INK, 1.4));
  }
  return out;
}

/** Creates the planner notebook for a month. */
export async function createMonthPlanner(db: NoteboardDB, year: number, month: number, parentId: ID | null): Promise<Notebook> {
  const days = new Date(year, month + 1, 0).getDate();
  const name = `Planner – ${new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
  const specs = [{ width: PAGE_WIDTH, height: PAGE_HEIGHT, template: 'blank' as const }, ...Array.from({ length: days }, () => ({ width: PAGE_WIDTH, height: PAGE_HEIGHT, template: 'ruled' as const }))];
  const notebook = await createNotebookFromPages(db, name, parentId, specs);
  const [monthId, ...dayIds] = notebook.pageIds as [ID, ...ID[]];
  await applyStrokeChange(db, monthId, monthPage(year, month, dayIds), []);
  for (let d = 1; d <= days; d++) await applyStrokeChange(db, dayIds[d - 1]!, dayPage(new Date(year, month, d), monthId), []);
  return notebook;
}
