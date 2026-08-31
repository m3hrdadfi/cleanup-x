import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { monthlySeries, yearlySeries, type PeriodCount } from "../lib/chart-data";

export function ArchiveTimeline({ values }: { values: PeriodCount[] }) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<"monthly" | "yearly">("monthly");
  const [inspected, setInspected] = useState<number | null>(null);
  const helpId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [values.length]);
  const months = monthlySeries(values);
  const data = mode === "monthly" ? months : yearlySeries(months);
  if (!data.length) return <p className="mt-5 text-sm text-zinc-500">{t("noData")}</p>;
  const peak = data.reduce((best, item, index) => item.count > data[best].count ? index : best, 0);
  const selected = Math.min(inspected ?? peak, data.length - 1);
  const height = 220, left = 42, right = 12, top = 12, bottom = 30;
  const ceiling = Math.max(4, Math.ceil(data[peak].count / 4) * 4);
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index: number) => left + (index + .5) / data.length * plotWidth;
  const y = (count: number) => top + plotHeight * (1 - count / ceiling);
  const line = data.map((item, index) => `${index ? "L" : "M"}${x(index)},${y(item.count)}`).join(" ");
  const dateLabel = (period: string, compact = false) => period.length === 4 ? new Intl.NumberFormat(i18n.language, { useGrouping: false }).format(Number(period)) : new Intl.DateTimeFormat(i18n.language, { month: compact ? "short" : "long", year: "numeric", timeZone: "UTC", calendar: "gregory" }).format(new Date(`${period}-01T00:00:00Z`));
  const ticks = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  const inspectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = ((event.clientX - bounds.left) / bounds.width * width - left) / plotWidth;
    setInspected(Math.max(0, Math.min(data.length - 1, Math.floor(position * data.length))));
  };
  return <div ref={container}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="chart-title">{t("archiveTimeline")}</h2><p className="chart-description">{t("archiveTimelineBody")}</p></div>
      <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700" aria-label={t("chartPeriod")} role="group">
        {(["monthly", "yearly"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setInspected(null); }} className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === value ? "bg-brand-700 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{t(value)}</button>)}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-baseline gap-2"><strong className="font-mono text-2xl font-semibold tabular-nums">{data[selected].count.toLocaleString(i18n.language)}</strong><span className="text-xs text-zinc-500 dark:text-zinc-400">{t("posts")} · {dateLabel(data[selected].month)}</span></div>
    <p id={helpId} className="sr-only">{t("chartInteractionHelp")}</p>
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700 dark:focus-visible:outline-brand-300" role="slider" tabIndex={0} aria-label={t("archiveTimeline")} aria-describedby={helpId} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={data.length - 1} aria-valuenow={selected} aria-valuetext={`${dateLabel(data[selected].month)}: ${data[selected].count.toLocaleString(i18n.language)} ${t("posts")}`} style={{ direction: "ltr" }} onPointerMove={inspectPoint} onPointerDown={(event) => { inspectPoint(event); event.currentTarget.focus(); }} onKeyDown={(event) => {
      const positions: Record<string, number> = { ArrowRight: selected + 1, ArrowUp: selected + 1, ArrowLeft: selected - 1, ArrowDown: selected - 1, Home: 0, End: data.length - 1 };
      if (!(event.key in positions)) return;
      event.preventDefault();
      setInspected(Math.max(0, Math.min(data.length - 1, positions[event.key])));
    }}>
      <title>{t("archiveTimeline")}</title><desc>{data.map((item) => `${dateLabel(item.month)}: ${item.count.toLocaleString(i18n.language)}`).join("; ")}</desc>
      {[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={left} x2={width - right} y1={y(ratio * ceiling)} y2={y(ratio * ceiling)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeDasharray={ratio ? "3 4" : undefined} /><text x={left - 8} y={y(ratio * ceiling) + 4} textAnchor="end" className="fill-zinc-500 font-mono text-[11px] dark:fill-zinc-400">{new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 }).format(ratio * ceiling)}</text></g>)}
      {mode === "monthly" ? <><path d={`${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="fill-brand-700/8 dark:fill-brand-400/10" /><path d={line} fill="none" className="stroke-brand-700 dark:stroke-brand-400" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /><line x1={x(selected)} x2={x(selected)} y1={top} y2={y(0)} className="stroke-brand-300" strokeDasharray="3 4" /><circle cx={x(selected)} cy={y(data[selected].count)} r="4" className="fill-brand-700 stroke-white dark:fill-brand-300 dark:stroke-zinc-900" strokeWidth="2" /></> : data.map((item, index) => <rect key={item.month} x={x(index) - plotWidth / data.length * .32} y={y(item.count)} width={plotWidth / data.length * .64} height={y(0) - y(item.count)} rx="2" className={index === selected ? "fill-brand-700 dark:fill-brand-400" : "fill-brand-200 dark:fill-brand-800"} />)}
      {ticks.map((index) => <text key={index} x={x(index)} y={height - 7} textAnchor={data.length === 1 ? "middle" : index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} className="fill-zinc-500 text-[11px] dark:fill-zinc-400">{dateLabel(data[index].month, true)}</text>)}
    </svg>
    <details className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800"><summary className="w-fit cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("viewChartData")}</summary><div className="mt-3 max-h-60 overflow-y-auto"><table className="w-full text-start text-xs"><thead><tr><th className="pb-2 text-start">{t("date")}</th><th className="pb-2 text-end">{t("posts")}</th></tr></thead><tbody>{data.map((item) => <tr key={item.month} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-2">{dateLabel(item.month)}</td><td className="text-end font-mono">{item.count.toLocaleString(i18n.language)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
