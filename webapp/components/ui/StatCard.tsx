import type { LucideIcon } from "lucide-react";

type Accent = "cyan" | "gold" | "success" | "danger";

const CHIP: Record<Accent, string> = {
  cyan: "bg-accent-cyan/10 text-accent-cyan ring-accent-cyan/25",
  gold: "bg-accent-gold/10 text-accent-gold ring-accent-gold/25",
  success: "bg-success/10 text-success ring-success/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
};

const VALUE: Record<Accent, string> = {
  cyan: "text-white",
  gold: "text-accent-gold",
  success: "text-success",
  danger: "text-danger",
};

const LINE: Record<Accent, string> = {
  cyan: "via-accent-cyan/40",
  gold: "via-accent-gold/40",
  success: "via-success/40",
  danger: "via-danger/40",
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  accent?: Accent;
  hint?: string;
  loading?: boolean;
}

/** Премиум KPI-карточка: стеклянная, с верхней неоновой кромкой и иконкой-чипом. */
export default function StatCard({ icon: Icon, label, value, accent = "cyan", hint, loading }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card/80 p-5 shadow-card backdrop-blur-sm transition hover:border-white/20">
      <div className={`absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent to-transparent ${LINE[accent]}`} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</span>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${CHIP[accent]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className={`mt-4 font-mono text-2xl font-bold tabular md:text-3xl ${VALUE[accent]}`}>
        {loading ? <span className="skeleton inline-block h-8 w-20 align-middle" /> : value}
      </div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}
