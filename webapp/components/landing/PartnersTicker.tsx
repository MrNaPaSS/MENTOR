"use client";

// Лента партнёров: знаки бирж плывут одной строкой.
//
// Сетка карточек отвечала на вопрос «где я буду торговать» и молчала о том,
// что бирж много и они настоящие. Лента говорит это одним взглядом: знаки
// идут подряд, узнаваемые и вперемешку, - так на витрине показывают
// партнёрство, а не список опций.
//
// Внутри ленты у каждой биржи стоит её доля возврата: цифра здесь не
// украшение, ради неё счёт и заводят через академию.
//
// Устройство простое: две одинаковые половины и сдвиг на половину ширины по
// кругу. Знаки не меняются в размере, поэтому подбирать шаг под пиксель
// экрана, как в биржевой ленте цен (`lib/marquee.ts`), здесь не нужно - там
// цифры дрожали краями, а картинке это не грозит.
//
// Лента замирает под мышью: пока она едет, по знаку не попасть, а знак - это
// ссылка на регистрацию.

import { ExternalLink } from "lucide-react";

import VenueMark from "@/components/ui/VenueMark";
import { EXCHANGE_SIGNUP } from "@/lib/content";
import { cashbackPct, TRADING, type PublicVenue } from "@/lib/venues";
import { useLocale, useT } from "@/lib/i18n";

export default function PartnersTicker() {
  const t = useT();
  const copy = t.landing.exchanges;

  // Две половины подряд: когда первая уходит влево целиком, на её месте уже
  // стоит вторая, и круг не виден.
  const half = [...TRADING, ...TRADING];

  return (
    <div
      className="group relative overflow-hidden py-2"
      // Края растворяются в фоне: лента не обрывается ножом по границе экрана.
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
      }}
    >
      <div className="flex w-max animate-marquee gap-4 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {half.map((venue, i) => (
          <Card key={`${venue.code}-${i}`} venue={venue} copy={copy} />
        ))}
      </div>
    </div>
  );
}

function Card({
  venue,
  copy,
}: {
  venue: PublicVenue;
  copy: ReturnType<typeof useT>["landing"]["exchanges"];
}) {
  const locale = useLocale();
  const link = EXCHANGE_SIGNUP.find((one) => one.code === venue.code);
  const back = cashbackPct(venue.cashback);

  const body = (
    <>
      <VenueMark
        code={venue.code}
        name={venue.name}
        decorative
        className="h-10 w-14 shrink-0"
        nameClassName="text-base"
      />
      <span className="min-w-0">
        <span className="block font-bold text-text-primary">{venue.name}</span>
        <span
          className={`block text-[13px] ${
            back ? "font-semibold text-accent-cyan" : "text-text-muted"
          }`}
        >
          {back
            ? copy.cashback(back)
            : venue.cashback === 0
              ? copy.noCashback
              : copy.cashbackSoon}
        </span>
      </span>
      {link && (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-60" />
      )}
    </>
  );

  const shell =
    "flex w-64 shrink-0 items-center gap-3 rounded-2xl border border-border bg-bg-panel/60 px-5 py-4 backdrop-blur-md";

  // Биржа без партнёрской ссылки остаётся в ленте, но не притворяется
  // кнопкой: вести с неё некуда.
  if (!link) return <div className={shell}>{body}</div>;

  return (
    <a
      href={link.url(locale)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${shell} transition-all duration-300 hover:-translate-y-0.5 hover:border-accent-cyan/40`}
    >
      {body}
    </a>
  );
}
