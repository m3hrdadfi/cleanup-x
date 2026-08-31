import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { useTranslation } from "react-i18next";
export function NotFoundPage() { const { t } = useTranslation(); return <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center"><p className="font-mono text-sm text-zinc-500">404</p><h1 className="mt-3 text-3xl font-semibold">{t("pageNotFound")}</h1><Button asChild className="mt-6"><Link to="/settings">{t("settings")}</Link></Button></div>; }
