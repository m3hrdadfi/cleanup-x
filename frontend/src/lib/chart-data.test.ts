import { describe, expect, it } from "vitest";
import { monthlySeries, yearlySeries } from "./chart-data";

describe("archive chart data", () => {
  it("keeps missing months on the time axis without inventing imported posts", () => {
    const values = [{ month: "2026-03", count: 5 }, { month: "2026-01", count: 2 }];
    expect(monthlySeries(values)).toEqual([{ month: "2026-01", count: 2 }, { month: "2026-02", count: 0 }, { month: "2026-03", count: 5 }]);
    expect(values[0].month).toBe("2026-03");
  });
  it("aggregates years without changing the total", () => {
    const months = monthlySeries([{ month: "2025-12", count: 10 }, { month: "2026-02", count: 7 }, { month: "2026-02", count: 3 }]);
    expect(yearlySeries(months)).toEqual([{ month: "2025", count: 10 }, { month: "2026", count: 10 }]);
  });
  it("handles empty, invalid, and single-period datasets", () => {
    expect(monthlySeries([])).toEqual([]);
    expect(monthlySeries([{ month: "2026-13", count: 10 }])).toEqual([]);
    expect(monthlySeries([{ month: "2026-08", count: 0 }])).toEqual([{ month: "2026-08", count: 0 }]);
  });
});
