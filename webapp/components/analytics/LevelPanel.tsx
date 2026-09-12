"use client";

// Уровень трейдера: кто он, звание, опыт до следующего и из чего он сложился.
//
// Бык на вершине с флагом - то, куда ведут уровни. Он стоит под всей верхней
// частью панели: флаг у самой её кромки, подножие сразу над плитками опыта, а
// полоса прогресса проходит поверх горы. На узком экране он прячется: там ему
// не хватает места, а цифры важнее картинки.

/* eslint-disable @next/next/no-img-element */

import CoinIcon from "@/components/app/CoinIcon";
import FramedAvatar from "@/components/avatar/FramedAvatar";
import { useIntlLocale, useT } from "@/lib/i18n";
import { XP_ART, type XpSource } from "@/lib/analytics/rewards";

export interface XpPart {
  key: XpSource;
  val: number;
}

export default function LevelPanel({
  level,
  xp,
  xpInLevel,
  xpNeeded,
  coins,
  parts,
  avatar = null,
  frame = null,
  name = "",
}: {
  level: number;
  xp: number;
  xpInLevel: number;
  xpNeeded: number;
  /** Баланс монет. Null - ещё не пришёл, и значок не показываем. */
  coins: number | null;
  parts: XpPart[];
  /** Аватар владельца, полный адрес. Нет - буква имени. */
  avatar?: string | null;
  /** Надетая рамка аватара. */
  frame?: string | null;
  name?: string;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const titles = t.analytics.level.titles;
  const title = Object.entries(titles).reverse().find(([l]) => level >= +l)?.[1] ?? titles[1];
  const pct = xpNeeded > 0 ? Math.min(100, (xpInLevel / xpNeeded) * 100) : 100;
  const levelLabel = `${t.analytics.level.short} ${level}`;

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3">
      {/* Верх панели. Картинка занимает всю его высоту: сверху заходит на
          внутренний отступ, чтобы флаг встал у самой кромки, снизу - под край
          плиток опыта. Растянута вширь на 20% трансформацией: так растяжение
          одно на любой ширине панели и никогда не сжимает картинку. Всё
          остальное поднято над ней: у картинки абсолютное место, и без этого
          она легла бы поверх текста, полосы и плиток. */}
      <div className="relative flex flex-1 flex-col">
        <img
          src="/art/level-summit.webp"
          alt=""
          className="art-glow pointer-events-none absolute -top-2 left-1/2 hidden h-[calc(100%+0.5rem+18px)] w-auto max-w-[44%] -translate-x-1/2 scale-x-[1.2] object-contain object-bottom sm:block"
        />

        <header className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.level.title}</h2>
            {/* Номер уровня - кружком сразу за названием панели. */}
            <span
              title={levelLabel}
              className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-[var(--pane-gold)] px-1 font-mono text-[11px] font-black leading-none text-[#171204]"
            >
              {level}
            </span>
          </div>
          {coins !== null && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--pane-gold-soft)] bg-[color:color-mix(in_srgb,var(--pane-gold)_10%,transparent)] px-2.5 py-1">
              <CoinIcon size={15} />
              <span className="font-mono text-sm font-extrabold tabular-nums text-[var(--pane-gold)]">
                {coins.toLocaleString(numbers)}
              </span>
              <span className="text-[9px] font-bold text-[color:color-mix(in_srgb,var(--pane-gold)_60%,transparent)]">NMNH</span>
            </div>
          )}
        </header>

        <div className="relative mb-3 mt-3 flex items-center gap-3">
          {/* Кто это: аватар владельца. Без купленной рамки - золотая
              обводка, как в профиле. */}
          <div className="relative shrink-0" title={levelLabel}>
            <div
              className={`rounded-full ${frame ? "" : "p-[2px]"}`}
              style={frame ? undefined : { background: "linear-gradient(135deg, #f5d27a, #b8860b 55%, #f0b90b)" }}
            >
              <FramedAvatar src={avatar} name={name || title} size={52} frame={frame} />
            </div>
          </div>
          <div className="min-w-0 shrink-0">
            <p className="text-sm font-bold text-[var(--pane-text)]">{title}</p>
            <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
              {t.analytics.level.toNext(Math.max(0, xpNeeded - xpInLevel).toLocaleString(numbers), level + 1)}
            </p>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <span className="font-mono text-2xl font-extrabold leading-none tabular-nums text-[var(--pane-text)]">
              {xp.toLocaleString(numbers)}
            </span>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-muted)]">
              {t.analytics.level.totalXp}
            </p>
          </div>
        </div>

        {/* Полоса и подпись под ней прижаты к низу верхней части: пустое место,
            если панель вытянута до соседней, остаётся над ними, под горой. */}
        <div className="relative mt-auto h-2.5 overflow-hidden rounded-full bg-[var(--pane-hover)]">
          <div
            className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
            style={{
              transform: `scaleX(${pct / 100})`,
              background: "linear-gradient(90deg, color-mix(in srgb, var(--pane-gold) 55%, #6b3f00), var(--pane-gold))",
            }}
          />
        </div>
        <p className="relative mt-1.5 text-right font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
          {xpInLevel.toLocaleString(numbers)} / {xpNeeded.toLocaleString(numbers)} XP
        </p>
      </div>

      <div className="relative grid grid-cols-2 gap-2 pt-3">
        {parts.map(({ key, val }) => (
          <div
            key={key}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-hover)] py-1.5 pl-1.5 pr-3"
          >
            <img src={XP_ART[key]} alt="" className="h-8 w-8 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--pane-text-2)]">
              {t.analytics.level.sources[key]}
            </span>
            <span
              className={`font-mono text-[12px] font-bold tabular-nums ${
                val > 0 ? "text-[var(--pane-text)]" : "text-[color:color-mix(in_srgb,var(--pane-muted)_60%,transparent)]"
              }`}
            >
              +{val.toLocaleString(numbers)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
