import { DownloadSimple, Translate } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import guide from "../locales/README.md?raw";
import guideUrl from "../locales/README.md?url";
import { Button } from "./ui/button";

const folder = "frontend/src/locales";
const guidePath = `${folder}/README.md`;

export function TranslationGuide() {
  const { t } = useTranslation();
  return <section id="settings-translations" className="my-4 scroll-mt-20 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <div className="flex items-start gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"><Translate size={20} /></span><div className="min-w-0"><h2 className="text-sm font-semibold">{t("localization")}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-600 dark:text-zinc-400">{t("localizationHelp")}</p><p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">{t("sourceLanguageNote")}</p></div></div>
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800"><p className="text-xs font-medium">{t("translationFolder")}</p><code dir="ltr" className="mt-1 block break-all text-xs text-brand-700 dark:text-brand-300">{folder}</code><p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">{t("translationFolderHelp")}</p>
      <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm leading-6"><li>{t("translationStepCopy")}</li><li>{t("translationStepRegister")}</li><li>{t("translationStepTest")}</li></ol>
      <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{t("readTranslationGuide")}</summary><p className="mt-3 text-xs text-zinc-500">{t("translationGuideSource")}</p><pre lang="en" dir="ltr" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-start font-mono text-xs leading-6">{guide}</pre></details>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><code dir="ltr" className="break-all text-[11px] text-zinc-500">{guidePath}</code><Button asChild variant="secondary" size="sm"><a href={guideUrl} download="cleanup-x-translation-guide.md"><DownloadSimple size={16} />{t("downloadTranslationGuide")}</a></Button></div>
    </div>
  </section>;
}
