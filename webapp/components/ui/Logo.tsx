import Link from "next/link";

interface LogoProps {
  href?: string;
  adminBadge?: boolean;
  className?: string;
  /**
   * Цвет самой надписи.
   *
   * По умолчанию белый - знак живёт на тёмном фоне сайта. В светлой теме
   * терминала фон белый, и белым по белому знака попросту не видно.
   */
  tone?: string;
}

export default function Logo({ href = "/", adminBadge, className = "", tone = "text-text-primary" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 text-xl font-extrabold tracking-tight ${className}`}
    >
      <span className={`glitch ${tone} group-hover:text-glow-cyan`} data-text="NMNH">
        NMNH
      </span>
      {adminBadge && (
        <span className="badge-gold ml-1 uppercase tracking-wider">admin</span>
      )}
    </Link>
  );
}
