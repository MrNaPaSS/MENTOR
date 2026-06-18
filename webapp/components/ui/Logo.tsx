import Link from "next/link";

interface LogoProps {
  href?: string;
  adminBadge?: boolean;
  className?: string;
}

export default function Logo({ href = "/", adminBadge, className = "" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 text-xl font-extrabold tracking-tight ${className}`}
    >
      <span className="glitch text-white group-hover:text-glow-cyan" data-text="NMNH">
        NMNH
      </span>
      {adminBadge && (
        <span className="badge-gold ml-1 uppercase tracking-wider">admin</span>
      )}
    </Link>
  );
}
