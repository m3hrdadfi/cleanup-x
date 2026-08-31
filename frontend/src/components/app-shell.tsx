import { Archive, ChartDonut, Gear, ListChecks, MagnifyingGlass, MoonStars, SidebarSimple, Sun, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { setTheme, useTheme } from "../lib/preferences";
import { BrandLogo } from "./brand-logo";

export function AppShell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const links = [
    { to: "/overview", label: t("overview"), icon: ChartDonut },
    { to: "/inventory", label: t("inventory"), icon: Archive },
    { to: "/search", label: t("semanticSearch"), icon: MagnifyingGlass },
    { to: "/scans/new", label: t("newScan"), icon: MagnifyingGlass },
    { to: "/deletions", label: t("deletionHistory"), icon: Trash },
    { to: "/audit", label: t("audit"), icon: ListChecks },
    { to: "/settings", label: t("settings"), icon: Gear },
  ];
  return <div className="relative min-h-[100dvh] bg-[#f7f7f8] text-[#282126] dark:bg-[#161416] dark:text-zinc-50">
    <a href="#main-content" className="fixed left-4 top-3 z-50 -translate-y-20 rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white focus:translate-y-0">{t("skipContent")}</a>
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950 md:hidden">
      <div className="flex items-center gap-2 font-semibold"><BrandLogo compact className="h-8 w-7" /><span aria-hidden="true">{t("appName")}</span></div>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="app-navigation" aria-label={t("toggleNavigation")}><SidebarSimple size={20} /></Button>
    </header>
    <aside id="app-navigation" className={cn("fixed inset-y-0 start-0 z-30 flex w-60 flex-col border-e border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 md:w-56", open ? "flex" : "max-md:hidden")}>
      <div className="flex flex-col items-center gap-3 px-2 py-4"><BrandLogo className="h-28 w-40" /><div className="text-center text-[11px] leading-4 text-zinc-500">{t("privateConsole")}</div></div>
      <nav className="mt-3 flex-1 space-y-1 overflow-y-auto">{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => cn("relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900", isActive && "bg-brand-100/70 text-brand-800 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-200")}><Icon className="shrink-0" size={19} weight="regular" /><span>{label}</span></NavLink>)}</nav>
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button variant="secondary" size="sm" aria-label={`${t("theme")}: ${t(theme === "dark" ? "light" : "dark")}`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={16} /> : <MoonStars size={16} />}
          <span className="sr-only">{t("theme")}</span>
        </Button>
      </div>
    </aside>
    {open && <button className="fixed inset-0 z-20 bg-zinc-950/40 md:hidden" onClick={() => setOpen(false)} aria-label={t("closeNavigation")} />}
    <main id="main-content" className="min-h-[100dvh] px-4 py-5 md:ms-56 md:px-6 md:py-7 xl:px-8"><div className="dashboard-content mx-auto max-w-[1440px]">
      {demoMode && <div role="status" className="mb-5 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-950 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100"><span className="font-semibold">{t("demoMode")}</span><span className="mx-2" aria-hidden="true">·</span>{t("demoModeHelp")}</div>}
      <Outlet />
    </div></main>
  </div>;
}
