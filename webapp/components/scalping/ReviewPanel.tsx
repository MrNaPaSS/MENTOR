"use client";

// Разбор: план недели и снимки сделок рядом.
//
// Слева то, что собирался делать, справа картинки того, что вышло. Разбор
// недели получается на одном экране: правила написаны в понедельник, а к
// пятнице видно, сколько раз они нарушены и как это выглядело на графике.
//
// Снимки собраны папками по сделкам, а не сплошной лентой. Лента врала глазу:
// два снимка одной сделки - вход и выход - стояли рядом как две разные сделки
// с одинаковым итогом, и складывалось впечатление, что заработано вдвое
// больше. Папка отвечает на это сразу: одна сделка, её данные, её картинки.
//
// Снимки берутся из тех же строк журнала, что и таблица: отдельного запроса
// нет, и разбор не может разойтись со списком сделок.

import { useMemo, useState } from "react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { weekStats } from "@/lib/weekStats";
import PlanForm from "./PlanForm";
import WeekReviewCard from "./WeekReviewCard";
import { shotImage } from "@/lib/journalShots";
import { isoWeek } from "@/lib/weekPlan";
import type { JournalRow } from "./JournalTable";

/**
 * Сколько папок видно до раскрытия: два ряда по шесть.
 *
 * Два ряда - это ровно та порция, которую глаз охватывает не прокручивая.
 * Монета с тридцатью позициями иначе вытесняет с экрана все остальные, и
 * разбор недели превращается в разбор одной монеты.
 */
const PAGE = 12;

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Нажали на папку: открыть позицию целиком. */
  onPick: (trade: JournalRow, number: number) => void;
}

/** Строка итога: подпись слева, число справа. */
function Line({
  label,
  value,
  hint,
  mood,
}: {
  label: string;
  value: string;
  hint?: string;
  mood?: number;
}) {
  return (
    <div className="flex items-baseline gap-1.5 py-0.5" title={hint}>
      <span className="text-[10px] text-[var(--pane-muted)]">{label}</span>
      <div className="flex-1 border-b border-dashed border-[var(--pane-border)]" />
      <span
        className={`font-mono text-[10px] ${
          mood === undefined || mood === 0
            ? "text-[var(--pane-text-2)]"
            : `font-bold ${tone(mood)}`
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function ReviewPanel({ rows, onPick }: ReviewPanelProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [week, setWeek] = useState(() => isoWeek());
  // Открыт ли разбор недели: собирается по кнопке, сам не лезет.
  const [sum, setSum] = useState(false);
  // Монеты, раскрытые целиком. Остальные показывают первые PAGE папок.
  const [wide, setWide] = useState<readonly string[]>([]);
  // Сделки, у которых есть снимки: только они и попадают в разбор.
  const folders = useMemo(
    () => rows.filter((row) => (row.shots?.length ?? 0) > 0),
    [rows],
  );

  // Номера позиций - сквозные по периоду, от самой ранней. По ним позицию и
  // называют в разговоре: «посмотри вторую», а не «ту, что в 19:05».
  const numberOf = useMemo(() => {
    const order = [...folders].sort((a, b) =>
      (a.opened_at ?? a.closed_at ?? "").localeCompare(b.opened_at ?? b.closed_at ?? ""),
    );
    const map = new Map<string, number>();
    order.forEach((one, i) => map.set(one.client_id, i + 1));
    return (trade: JournalRow) => map.get(trade.client_id) ?? 0;
  }, [folders]);

  // Цифры недели: по закрытым сделкам той же недели, что и план. Сделки
  // соседних недель в списке быть могут - период журнала шире, - и в итог
  // недели они не попадают.
  const stats = useMemo(() => weekStats(rows, week), [rows, week]);

  // Позиции по монетам: неделя - инструмент - позиция. Разбирают их так же:
  // сперва смотрят, что было по BTC, потом что по ETH.
  const byCoin = useMemo(() => {
    const map = new Map<string, JournalRow[]>();
    for (const trade of folders) {
      const coin = trade.symbol.replace(/USDT$/, "");
      map.set(coin, [...(map.get(coin) ?? []), trade]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [folders]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <PlanForm week={week} onWeek={setWeek}>
        {/* Итог недели строками, а не в подбор: цифры разные по смыслу, и
            в один ряд они читались как одно предложение. Подписи слева,
            значения справа - глаз идёт по столбцу и сравнивает. */}
        <div className="border-t border-[var(--pane-border)] px-2 py-1.5">
          {stats.trades === 0 ? (
            <p className="py-1 text-[10px] text-[var(--pane-muted)]">{t.journal.weekEmpty}</p>
          ) : (
            <>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pane-muted)]">
                  {t.journal.weekTotalsTitle}
                </span>
                <div className="flex-1" />
                <span className={`font-mono text-[12px] font-bold ${tone(stats.pnl)}`}>
                  {money(stats.pnl)}
                </span>
              </div>

              <Line
                label={t.journal.weekTradesLabel}
                hint={t.journal.weekTradesHint}
                value={`${stats.marked} / ${stats.trades}`}
              />
              {stats.gain !== null && (
                <Line
                  label={t.journal.weekGainLabel}
                  hint={t.journal.weekGainHint}
                  value={`${stats.gain > 0 ? "+" : ""}${stats.gain.toFixed(1)}%`}
                  mood={stats.pnl}
                />
              )}
              <Line
                label={t.journal.weekWinrateLabel}
                hint={t.journal.weekWinrateHint}
                value={`${Math.round((stats.winrate ?? 0) * 100)}%`}
              />
              {/* Нарушения показываются, только если их отмечали: ноль
                  нарушений у неразобранной недели - не заслуга, а пустота. */}
              {stats.marked > 0 && (
                <Line
                  label={t.journal.weekBreaksLabel}
                  hint={t.journal.weekBreaksHint}
                  value={String(stats.breaks)}
                  mood={stats.breaks > 0 ? -1 : 0}
                />
              )}

              {/* Разбор недели собирается из этих же цифр, но целиком: сессии,
                  нарушения, поведение после убытка. */}
              <button
                onClick={() => setSum(true)}
                className="mt-1.5 w-full rounded border border-[var(--pane-border)] py-1 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
              >
                {t.journal.weekReviewMake}
              </button>
            </>
          )}
        </div>
      </PlanForm>

      <div className="rounded-lg border border-[var(--pane-border)] p-2">
        {byCoin.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
            {t.journal.galleryEmpty}
          </p>
        ) : (
          <div className="grid gap-3">
            {byCoin.map(([coin, list]) => (
              <section key={coin}>
                {/* У монеты свой итог: неделя по BTC и неделя по ETH - разные
                    недели, и складывать их глазом человек не должен. */}
                <div className="mb-1.5 flex items-baseline gap-1.5">
                  <h3 className="font-mono text-[11px] font-bold text-[var(--pane-text)]">
                    {coin}
                  </h3>
                  <span className="text-[10px] text-[var(--pane-muted)]">
                    {t.journal.positionsIn(list.length)} ·{" "}
                    {t.journal.shotsIn(
                      list.reduce((sum, one) => sum + (one.shots?.length ?? 0), 0),
                    )}
                  </span>
                  <div className="h-px flex-1 bg-[var(--pane-border)]" />
                  <span
                    className={`font-mono text-[11px] font-bold ${tone(
                      list.reduce((sum, one) => sum + one.pnl, 0),
                    )}`}
                  >
                    {money(list.reduce((sum, one) => sum + one.pnl, 0))}
                  </span>
                </div>

                {/* Папки квадратами, а не полосами во всю ширину: позиция это
                    одна вещь и выглядеть должна как одна вещь. Полосой во весь
                    экран одна сделка занимала столько же места, сколько целый
                    день работы. */}
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {(wide.includes(coin) ? list : list.slice(0, PAGE)).map((trade) => {
                    const cover = (trade.shots ?? [])[0];
                    return (
                      <button
                        key={trade.client_id}
                        onClick={() => onPick(trade, numberOf(trade))}
                        className="overflow-hidden rounded-lg border border-[var(--pane-border)] text-left transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)]"
                      >
                        {/* Обложка - первый снимок папки: по нему её узнают
                            среди прочих, как книгу по корешку. */}
                        <div className="relative aspect-[4/3] w-full bg-[var(--pane-hover)]">
                          {cover && (
                            <img
                              src={shotImage(cover)}
                              alt={trade.symbol}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          )}
                          <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white/80">
                            {trade.shots?.length ?? 0}
                          </span>
                          {/* Нарушение видно прямо на папке: разбор недели
                              начинают с того, где не удержались. */}
                          {trade.plan_ok === false && (
                            <span className="absolute left-1 top-1 rounded bg-[var(--pane-down)] px-1 text-[9px] font-bold text-white">
                              !
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 px-1 py-0.5">
                          <span className="font-mono text-[10px] text-[var(--pane-text-2)]">
                            {t.journal.positionNo(numberOf(trade))}
                          </span>
                          <span
                            className={
                              trade.side === "long"
                                ? "text-[9px] text-[var(--pane-up)]"
                                : "text-[9px] text-[var(--pane-down)]"
                            }
                          >
                            {trade.side === "long" ? t.journal.long : t.journal.short}
                          </span>
                          <div className="flex-1" />
                          <span className={`font-mono text-[10px] font-bold ${tone(trade.pnl)}`}>
                            {money(trade.pnl)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 px-1 pb-0.5 text-[9px] text-[var(--pane-muted)]">
                          <span>
                            {new Date(
                              trade.closed_at ?? trade.opened_at ?? "",
                            ).toLocaleString(numbers, {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {trade.targets.length > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              {trade.targets.map((_, i) => (
                                <span
                                  key={i}
                                  className={
                                    i < trade.takes_hit ? "text-[var(--pane-up)]" : "opacity-50"
                                  }
                                >
                                  {i < trade.takes_hit ? "●" : "○"}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {list.length > PAGE && (
                  <button
                    onClick={() =>
                      setWide((was) =>
                        was.includes(coin)
                          ? was.filter((one) => one !== coin)
                          : [...was, coin],
                      )
                    }
                    className="mt-1 text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
                  >
                    {wide.includes(coin)
                      ? t.journal.foldersLess
                      : t.journal.foldersMore(list.length - PAGE)}
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {sum && <WeekReviewCard rows={rows} week={week} onClose={() => setSum(false)} />}
    </div>
  );
}
