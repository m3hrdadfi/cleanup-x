export type PeriodCount = { month: string; count: number };

/** Missing months contain no locally imported posts, not necessarily no posts on X. */
export function monthlySeries(values: PeriodCount[]): PeriodCount[] {
  const sorted = [...values].filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)).sort((a, b) => a.month.localeCompare(b.month));
  if (!sorted.length) return [];
  const totals = new Map<string, number>();
  for (const item of sorted) totals.set(item.month, (totals.get(item.month) || 0) + item.count);
  const start = new Date(`${sorted[0].month}-01T00:00:00Z`);
  const end = sorted.at(-1)!.month;
  const result: PeriodCount[] = [];
  while (start.toISOString().slice(0, 7) <= end) {
    const month = start.toISOString().slice(0, 7);
    result.push({ month, count: totals.get(month) || 0 });
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return result;
}

export function yearlySeries(values: PeriodCount[]): PeriodCount[] {
  const years = new Map<string, number>();
  for (const item of values) {
    const year = item.month.slice(0, 4);
    years.set(year, (years.get(year) || 0) + item.count);
  }
  return [...years].map(([month, count]) => ({ month, count }));
}
