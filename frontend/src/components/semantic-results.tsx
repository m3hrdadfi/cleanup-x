import { ArrowSquareOut, CaretLeft, CaretRight, Check, Copy, TextAlignLeft } from "@phosphor-icons/react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { contentTypeLabel, languageName, number } from "../lib/localization";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export type SearchResult = {
  mode: string; candidates: number; indexed_candidates: number; total: number;
  items: { id: string; text: string; context: string; language: string; content_type: string; posted_at: string | null; similarity: number | null }[];
};
type Sort = "rank" | "similarity" | "newest";

// Render untrusted post content as text, never HTML. Highlights are literal query words,
// not claims that the model used those words to produce its similarity score.
function HighlightedText({ text, words }: { text: string; words: Set<string> }) {
  return <>{text.split(/([\p{L}\p{N}_]+)/u).map((part, index) => words.has(part.toLocaleLowerCase())
    ? <mark key={index} className="rounded-sm bg-brand-100 px-0.5 text-brand-950 dark:bg-brand-900 dark:text-brand-100">{part}</mark>
    : part)}</>;
}

export function SemanticResults({ data, query }: { data: SearchResult; query: string }) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | undefined>(data.items[0]?.id);
  const [sort, setSort] = useState<Sort>("rank");
  const [highlight, setHighlight] = useState(true);
  const [copyState, setCopyState] = useState<{ id: string; status: "success" | "failed" } | null>(null);
  const readerId = useId();
  const reader = useRef<HTMLElement>(null);
  const ordered = useMemo(() => [...data.items].sort((a, b) => {
    if (sort === "similarity") return (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity);
    if (sort === "newest") return (Date.parse(b.posted_at || "") || 0) - (Date.parse(a.posted_at || "") || 0);
    return 0; // Retain server ranking, including hybrid rank fusion.
  }), [data.items, sort]);
  const index = Math.max(0, ordered.findIndex((item) => item.id === selectedId));
  const selected = ordered[index];
  const words = useMemo(() => new Set(highlight ? (query.toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || []).slice(0, 40) : []), [query, highlight]);
  const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(value)) : t("unknownValue");
  const score = (value: number | null) => value === null ? t("searchKeywordOnly") : t("searchSimilarity", { value: number(value, { maximumFractionDigits: 3 }) });
  const choose = (id: string) => {
    setSelectedId(id); setCopyState(null);
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      reader.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
      reader.current?.focus({ preventScroll: true });
    }
  };
  const copy = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.context); setCopyState({ id: selected.id, status: "success" }); }
    catch { setCopyState({ id: selected.id, status: "failed" }); }
  };
  const heading = <div className="min-w-0"><h2 className="text-base font-semibold">{t("searchResults")}</h2><p dir="auto" className="mt-1 max-w-3xl break-words text-sm text-zinc-600 dark:text-zinc-400">{query}</p></div>;
  if (!selected) return <section aria-label={t("searchResults")} className="rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700">{heading}<p className="mt-5 text-sm text-zinc-500">{t("searchEmpty")}</p></section>;

  return <section aria-label={t("searchResults")} className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-4">
      {heading}
      <label className="grid gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">{t("searchSortReturned")}<select className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" value={sort} onChange={(event) => { setSort(event.target.value as Sort); setSelectedId(undefined); setCopyState(null); }}>
        <option value="rank">{t("searchOrder")}</option><option value="similarity" disabled={data.mode === "keyword"}>{t("searchSortSimilarity")}</option><option value="newest">{t("searchSortNewest")}</option>
      </select></label>
    </header>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-zinc-200 py-3 dark:border-zinc-800">
      <Badge>{data.mode === "hybrid" ? t("search_hybrid") : data.mode === "semantic" ? t("search_semantic") : t("search_keyword")}</Badge>
      <p role="status" className="text-xs text-zinc-500">{t("searchCoverage", { shown: number(data.items.length), total: number(data.candidates), indexed: number(data.indexed_candidates) })}</p>
    </div>
    {data.mode === "hybrid" && <p className="max-w-3xl text-xs leading-5 text-zinc-500">{t("searchHybridOrderHelp")}</p>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"><p className="text-xs font-medium text-zinc-500">{t("searchBrowseResults")}</p><span className="font-mono text-xs text-zinc-500">{number(ordered.length)}</span></div>
        <ol aria-label={t("searchBrowseResults")} className="max-h-80 divide-y divide-zinc-100 overflow-y-auto overscroll-contain dark:divide-zinc-800 lg:max-h-[38rem]">
          {ordered.map((item, position) => <li key={item.id}>
            <button type="button" aria-pressed={item.id === selected.id} aria-controls={readerId} onClick={() => choose(item.id)} className={cn("w-full border-s-[3px] p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700", item.id === selected.id ? "border-brand-700 bg-brand-50 dark:border-brand-300 dark:bg-brand-950" : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/60")}>
              <span className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400"><span className="font-mono font-semibold text-brand-700 dark:text-brand-300">{number(position + 1, { minimumIntegerDigits: 2 })}</span><span>{contentTypeLabel(item.content_type)}</span><span className="ms-auto">{date(item.posted_at)}</span></span>
              <span dir="auto" className="line-clamp-3 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200"><HighlightedText text={item.context.replace(/\s+/g, " ")} words={words} /></span>
              <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400"><span>{languageName(item.language)}</span><span className="font-mono tabular-nums">{score(item.similarity)}</span></span>
            </button>
          </li>)}
        </ol>
      </div>
      <article id={readerId} ref={reader} tabIndex={-1} aria-label={t("searchReadPost")} className="min-w-0 scroll-mt-20 rounded-xl border border-zinc-200 bg-white outline-none focus-visible:ring-2 focus-visible:ring-brand-700 dark:border-zinc-800 dark:bg-zinc-900 lg:sticky lg:top-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 text-sm font-medium"><TextAlignLeft size={17} aria-hidden />{t("searchReadPost")}</h3><div className="flex items-center gap-1"><span className="me-2 text-xs tabular-nums text-zinc-500">{t("searchResultPosition", { current: number(index + 1), total: number(ordered.length) })}</span><Button size="sm" variant="ghost" aria-label={t("previous")} disabled={index === 0} onClick={() => choose(ordered[index - 1].id)}><CaretLeft className="rtl:rotate-180" aria-hidden /></Button><Button size="sm" variant="ghost" aria-label={t("next")} disabled={index === ordered.length - 1} onClick={() => choose(ordered[index + 1].id)}><CaretRight className="rtl:rotate-180" aria-hidden /></Button></div>
        </header>
        <div className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-zinc-500"><Badge>{contentTypeLabel(selected.content_type)}</Badge><span>{languageName(selected.language)}</span><span className="ms-auto">{date(selected.posted_at)}</span></div>
          <p className="mb-2 text-[11px] text-zinc-500">{t("searchStoredContent")}</p>
          <p dir="auto" className="max-w-prose whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-900 dark:text-zinc-100"><HighlightedText text={selected.context} words={words} /></p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"><span className="font-mono text-xs tabular-nums text-brand-800 dark:text-brand-200">{score(selected.similarity)}</span><label className="flex items-center gap-2 text-xs text-zinc-500"><input type="checkbox" className="accent-brand-700" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />{t("searchHighlightWords")}</label></div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{t("searchScoreCaution")}</p>
        </div>
        <footer className="space-y-3 rounded-b-xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950/30">
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" onClick={() => void copy()}>{copyState?.id === selected.id && copyState.status === "success" ? <Check aria-hidden /> : <Copy aria-hidden />}{t(copyState?.id === selected.id && copyState.status === "success" ? "searchCopied" : "searchCopyText")}</Button>{/^\d+$/.test(selected.id) && <Button asChild variant="ghost" size="sm"><a href={`https://x.com/i/status/${selected.id}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("searchOpenX")}<ArrowSquareOut aria-hidden /></a></Button>}</div>
          {copyState?.id === selected.id && <p role="status" className="text-xs text-zinc-500">{t(copyState.status === "success" ? "searchCopied" : "searchCopyFailed")}</p>}
          <p dir="ltr" className="break-all font-mono text-[10px] text-zinc-500">{selected.id}</p>
        </footer>
      </article>
    </div>
  </section>;
}
