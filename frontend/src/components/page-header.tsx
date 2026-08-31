export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <header className="page-heading mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
    <div className="min-w-0">
      <h1 className="max-w-4xl break-words text-2xl font-semibold leading-tight tracking-[-0.035em] text-balance lg:text-[28px]">{title}</h1>
      {description && <p className="mt-2 max-w-[76ch] text-sm leading-5 text-zinc-600 text-pretty dark:text-zinc-400">{description}</p>}
    </div>
    {action && <div className="header-actions flex flex-wrap items-center gap-2">{action}</div>}
  </header>;
}
