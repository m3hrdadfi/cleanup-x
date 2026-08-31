import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

export function BrandLogo({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  // Frame the original assets without their outer padding; keep the PNGs unchanged.
  return <svg role="img" aria-label={t("appName")} viewBox={compact ? "390 210 480 550" : "50 210 1130 830"} className={cn("shrink-0", className)}>
    <image className="dark:hidden" href="/branding/light-logo.png" width="1254" height="1254" />
    <image className="hidden dark:block" href="/branding/dark-logo.png" width="1254" height="1254" />
  </svg>;
}
