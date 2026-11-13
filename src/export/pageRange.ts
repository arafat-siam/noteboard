/**
 * Reads a page list like "1-3, 5, 8-" (1-based, as people count pages) and returns the 0-based
 * page indexes in order, without duplicates. Returns null if the text can't be understood.
 */
export function parsePageRange(text: string, total: number): number[] | null {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (i: number) => {
    if (i >= 0 && i < total && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part);
    if (m && (m[1] || m[2])) {
      const from = m[1] ? Number(m[1]) : 1;
      const to = m[2] ? Number(m[2]) : total;
      if (from < 1 || to < 1) return null;
      const step = from <= to ? 1 : -1;
      for (let n = from; step > 0 ? n <= to : n >= to; n += step) add(n - 1);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1) return null;
      add(n - 1);
    } else {
      return null;
    }
  }
  return out.length ? out : null;
}

/** Short description of page indexes for file names: "p3", "p1-4", "p1-3,6". */
export function describePages(indexes: number[]): string {
  const sorted = [...indexes].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(i === j ? `${sorted[i]! + 1}` : `${sorted[i]! + 1}-${sorted[j]! + 1}`);
    i = j + 1;
  }
  return `p${runs.join(',')}`;
}
