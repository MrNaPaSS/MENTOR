import Link from "next/link";
import { TrendingUp } from "lucide-react";

interface LogoProps {
  href?: string;
  adminBadge?: boolean;
  className?: string;
}

/** Логотип NMNH с глитч-эффектом при hover (ТЗ §5.1). */
export default function Logo({ href = "/", adminBadge, className = "" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 text-xl font-extrabold tracking-tight ${className}`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30 transition group-hover:shadow-glow-cyan">
        <TrendingUp className="h-5 w-5" strokeWidth={2.5} />
      </span>
      <span className="glitch text-white group-hover:text-glow-cyan" data-text="NMNH">
        NMNH
      </span>
      {adminBadge && (
        <span className="badge-gold ml-1 uppercase tracking-wider">admin</span>
      )}
    </Link>
  );
}
