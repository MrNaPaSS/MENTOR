import Link from "next/link";
import Image from "next/image";

interface LogoProps {
  href?: string;
  adminBadge?: boolean;
  className?: string;
}

export default function Logo({ href = "/", adminBadge, className = "" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 ${className}`}
    >
      <Image
        src="/logo.png"
        alt="NMNH"
        width={40}
        height={40}
        className="rounded-lg transition group-hover:opacity-90"
      />
      {adminBadge && (
        <span className="badge-gold uppercase tracking-wider">admin</span>
      )}
    </Link>
  );
}
