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
      {/* Астронавт - знак сайта. Живой: шлем дышит бликом, и в шапке это
          единственное, что двигается само по себе. Картинкой, а не разметкой:
          рисунок пришёл готовым, и повторять его векторами значило бы держать
          два разных астронавта, которые однажды разойдутся.

          Своим кругом, а не вырезанный по контуру: круг тут часть знака -
          иллюминатор, в который смотрят с той стороны. */}
      <img
        src="/logo-astronaut.gif"
        alt=""
        width={28}
        height={28}
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full"
      />
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
