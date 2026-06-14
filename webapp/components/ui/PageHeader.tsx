import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}

/** Единый заголовок страницы (эйбров + título + действие справа). */
export default function PageHeader({ eyebrow, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="text-h2 mt-1 text-white">{title}</h1>
        {subtitle && <p className="mt-1.5 text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
