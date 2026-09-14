"use client";

// Кнопка «Открыть счёт на бирже» и окно с выбором биржи.
//
// Раньше на её месте везде стояло «Открыть счёт на WEEX». Это было правдой
// ровно один день - тот, когда биржа была одна. Теперь их пять, и кнопка с
// одним именем работает против нас дважды: человеку со счётом на OKX она
// говорит «тебе сюда не надо», а человеку без счёта вообще не даёт выбрать.
//
// Поэтому кнопка одна и ведёт не на биржу, а в окно, где видно все пять и то
// единственное, чем они друг от друга отличаются для новичка: сколько
// комиссии возвращается. Где возврата нет, стоит причина, а не пустота -
// Binance запрещает его сам, у MEXC долю ещё не назвали.
//
// Цифры и список - из общего реестра (`lib/venues.ts`), который сверяется с
// сервером тестом, а ссылки - из реестра партнёрских ссылок. Биржа без ссылки
// в окно не попадает: счёт, открытый мимо неё, к академии не привяжется, и
// условий на нём не будет.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import VenueMark from "@/components/ui/VenueMark";
import { EXCHANGE_SIGNUP } from "@/lib/content";
import { cashbackPct, TRADING } from "@/lib/venues";
import { useLocale, useT } from "@/lib/i18n";

/** Биржи окна: торгуем и есть по какой ссылке заводить счёт. */
const OPTIONS = TRADING.map((venue) => ({
  venue,
  link: EXCHANGE_SIGNUP.find((one) => one.code === venue.code),
})).filter((one) => one.link);

export default function SignupPicker({ className, label }: { className: string; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const copy = t.landing.signup;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label ?? copy.button}
        <ExternalLink className="h-[14px] w-[14px] opacity-50" />
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const copy = t.landing.signup;

  // Esc закрывает окно, а страница под ним не едет: иначе список бирж
  // прокручивает фон, и человек теряет место, где читал.
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKey);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = scroll;
    };
  }, [onKey]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-bg-deep/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-bg-panel/95 p-5 shadow-card backdrop-blur-xl md:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{copy.title}</h2>
            <p className="mt-1 text-sm text-text-muted">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-bg-card/60 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-5 grid gap-2">
          {OPTIONS.map(({ venue, link }) => {
            const back = cashbackPct(venue.cashback);
            return (
              <li key={venue.code}>
                <a
                  href={link!.url(locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-border bg-bg-card/60 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-cyan/40"
                >
                  <VenueMark
                    code={venue.code}
                    name={venue.name}
                    decorative
                    className="h-8 w-10 shrink-0"
                    nameClassName="text-xs"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-text-primary">{venue.name}</span>
                    {/* Возврат - цветом, его отсутствие - приглушённо. Одно
                        здесь предложение, другое оговорка, и выглядеть
                        одинаково они не должны. */}
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
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-text-secondary transition group-hover:text-text-primary">
                    {copy.open}
                    <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-xs leading-relaxed text-text-muted">{copy.note}</p>
      </div>
    </div>
  );
}
