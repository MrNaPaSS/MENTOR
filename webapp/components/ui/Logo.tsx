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
      {/* Знак пишется адресом целиком: он же и подпись под снимками, и то, что
          люди набирают в строке браузера. Разные написания в разных местах
          читались как разные вещи. */}
      <span className={`glitch ${tone} group-hover:text-glow-cyan`} data-text="NMNH.TRADE">
        NMNH.TRADE
      </span>
      {adminBadge && (
        <span className="badge-gold ml-1 uppercase tracking-wider">admin</span>
      )}
    </Link>
  );
}
