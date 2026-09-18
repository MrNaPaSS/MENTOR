"use client";

// Разбор: тот же месяц, что и в списке, но картинками.
//
// Ни итогов, ни календаря здесь нет: и то и другое уже есть в списке, а
// вторая копия занимает половину экрана, ничего не добавляя. Слева - цифры
// самого разбора: сколько сделок разобрано и сколько нарушений отмечено, - и
// карта торговли: день выбирают её клеткой, а выбранный день у вкладок общий.
//
// Правая половина - папки: монеты дня, внутри монеты её позиции со снимками.
//
// Разбирают именно так, сверху вниз: сперва выбирают день в календаре, потом
// монету, и только потом смотрят картинки одной позиции. Всё сразу на одном
// экране означало полсотни мелких плиток, между которыми глазу не за что
// зацепиться.
//
// Снимки берутся из тех же строк журнала, что и таблица: отдельного запроса
// нет, и разбор не может разойтись со списком сделок.

import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { shotImage } from "@/lib/journalShots";
import { isoWeek } from "@/lib/weekPlan";
import { sumUp } from "@/lib/weekStats";
import { sessionOf } from "./PositionCard";
import type { SessionName } from "@/lib/weekReview";
import ActivityHeat from "./ActivityHeat";
import WeekReviewCard from "./WeekReviewCard";
import type { JournalRow } from "./JournalTable";

/** Сколько сделок монеты видно до раскрытия. */
const PAGE = 12;

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Месяц, выбранный в списке: журнал у обеих вкладок один. */
  year: number;
  month: number;
  /** Выбранный день, `2026-09-17`. Пусто - показываем месяц целиком. */
  picked: string | null;
  onPickDay: (date: string | null) => void;
  /** Нажали на папку сделки: открыть позицию целиком. */
  onPick: (trade: JournalRow, number: number) => void;
}

/** Когда сделка случилась. Ноль - времени нет, в разбор она не попадёт. */
function timeOf(row: JournalRow): number {
  const at = row.closed_at ?? row.opened_at;
  if (!at) return 0;
  const when = new Date(at).getTime();
  return Number.isNaN(when) ? 0 : when;
}

/** Ключ дня сделки по местному времени: им же помечены клетки календаря. */
function dayOf(row: JournalRow): string {
  const at = new Date(timeOf(row));
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** Строка цифр: подпись слева, число справа, пунктир между ними. */
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

/** Папка разбора: обложка, имя поверх неё, ярлык и итог снизу. */
function Folder({
  name,
  badge,
  note,
  sum,
  cover,
  mark,
  onOpen,
}: {
  name: string;
  badge?: string;
  note?: string;
  sum?: number;
  cover?: string;
  mark?: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group overflow-hidden rounded-lg border border-[var(--pane-border)] text-left transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--pane-hover)]">
        {cover && (
          <img
            src={cover}
            alt={name}
            className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
          />
        )}
        {/* Имя поверх обложки: папку узнают по нему, а не по картинке -
            графики у всех похожи. */}
        <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 font-mono text-[12px] font-bold text-white">
          {name}
        </span>
        {badge && (
          <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white/80">
            {badge}
          </span>
        )}
        {/* Нарушения видны прямо на папке: разбор начинают с того, где не
            удержались. */}
        {mark !== undefined && mark > 0 && (
          <span className="absolute left-1 top-1 rounded bg-[var(--pane-down)] px-1 text-[9px] font-bold text-white">
            {mark}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1 text-[9px]">
        <span className="text-[var(--pane-muted)]">{note ?? ""}</span>
        <div className="flex-1" />
        {sum !== undefined && (
          <span className={`font-mono text-[10px] font-bold ${tone(sum)}`}>{money(sum)}</span>
        )}
      </div>
    </button>
  );
}

export default function ReviewPanel({
  rows,
  year,
  month,
  picked,
  onPickDay,
  onPick,
}: ReviewPanelProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [coin, setCoin] = useState<string | null>(null);
  const [sum, setSum] = useState(false);
  const [wide, setWide] = useState(false);

  // Сделки с картинками: только они и попадают в разбор.
  const shots = useMemo(
    () => rows.filter((row) => (row.shots?.length ?? 0) > 0 && timeOf(row) > 0),
    [rows],
  );

  // Что разбираем: выбранный день или весь месяц календаря.
  const here = useMemo(
    () =>
      shots.filter((row) => {
        if (picked) return dayOf(row) === picked;
        const at = new Date(timeOf(row));
        return at.getFullYear() === year && at.getMonth() + 1 === month;
      }),
    [shots, picked, year, month],
  );

  /** Сделки по монетам, где больше - выше. */
  const byCoin = useMemo(() => {
    const map = new Map<string, JournalRow[]>();
    for (const row of here) {
      const name = row.symbol.replace(/USDT$/, "");
      map.set(name, [...(map.get(name) ?? []), row]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [here]);

  const inCoin = useMemo(
    () => (coin === null ? [] : (byCoin.find(([name]) => name === coin)?.[1] ?? [])),
    [byCoin, coin],
  );

  // Номера позиций - сквозные по тому, что открыто, от самой ранней. По ним
  // позицию и называют в разговоре: «посмотри вторую», а не «ту, что в 19:05».
  const numberOf = useMemo(() => {
    const order = [...here].sort((a, b) => timeOf(a) - timeOf(b));
    const map = new Map<string, number>();
    order.forEach((one, i) => map.set(one.client_id, i + 1));
    return (trade: JournalRow) => map.get(trade.client_id) ?? 0;
  }, [here]);

  // Цифры - по всем сделкам куска, а не только по тем, где есть снимки: итог
  // дня это итог дня, картинки его не меняют.
  const all = useMemo(
    () =>
      rows.filter((row) => {
        if (row.closed_at === null || timeOf(row) === 0) return false;
        if (picked) return dayOf(row) === picked;
        const at = new Date(timeOf(row));
        return at.getFullYear() === year && at.getMonth() + 1 === month;
      }),
    [rows, picked, year, month],
  );
  const stats = useMemo(() => sumUp(all), [all]);

  // Нарушения по кодам: их ставит сам трейдер в карточке позиции, и только
  // они и считаются. Догадываться за человека, что он нарушил, нельзя.
  const breaks = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of all) {
      for (const code of row.mistakes ?? []) {
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
    }
    return [...tally.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [all]);

  // Что ещё не разобрано: сделка без отметки и сделка без единого снимка.
  // Это и есть работа, которую разбор от человека ждёт.
  const undone = useMemo(() => {
    const noMark = all.filter((row) => row.plan_ok !== true && row.plan_ok !== false);
    const noShot = all.filter((row) => (row.shots?.length ?? 0) === 0);
    return { noMark, noShot };
  }, [all]);

  // Куда уходят деньги по времени входа: у вечера и у Лондона разная цена
  // ошибки, и видно это только рядом.
  const sessions = useMemo(() => {
    const map = new Map<SessionName, { trades: number; pnl: number }>();
    for (const row of all) {
      const name = sessionOf(row.opened_at);
      const was = map.get(name) ?? { trades: 0, pnl: 0 };
      map.set(name, { trades: was.trades + 1, pnl: was.pnl + row.pnl });
    }
    return [...map.entries()].sort((a, b) => b[1].trades - a[1].trades);
  }, [all]);

  function coverOf(list: readonly JournalRow[]): string | undefined {
    const first = [...list].sort((a, b) => timeOf(a) - timeOf(b))[0];
    const shot = (first?.shots ?? [])[0];
    return shot ? shotImage(shot) : undefined;
  }

  function brokenIn(list: readonly JournalRow[]): number {
    return list.filter((one) => one.plan_ok === false).length;
  }

  return (
    <div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* Левая половина - четыре виджета, а не один на всю высоту.
            Растянутый блок с четырьмя строками цифр оставлял под собой пустое
            поле в пол-экрана, и разбор выглядел недоделанным. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {/* Итог куска: деньги и дисциплина рядом. */}
          <div className="rounded-lg border border-[var(--pane-border)] px-2 py-1.5">
            <div className="mb-1 flex items-baseline gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
                {picked ? t.journal.totalsDay : t.journal.totalsMonth}
              </span>
              <div className="flex-1" />
              {/* Выбран день - показываем, чем из него выйти обратно в месяц. */}
              {picked ? (
                <button
                  onClick={() => {
                    onPickDay(null);
                    setCoin(null);
                  }}
                  className="rounded border border-[var(--pane-border)] px-1.5 py-0.5 text-[9px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-text)]"
                >
                  {t.journal.wholeMonth}
                </button>
              ) : (
                <span className={`font-mono text-[11px] font-bold ${tone(stats.pnl)}`}>
                  {stats.trades > 0 ? money(stats.pnl) : "-"}
                </span>
              )}
            </div>

            {stats.trades === 0 ? (
              <p className="py-1 text-[10px] text-[var(--pane-muted)]">{t.journal.weekEmpty}</p>
            ) : (
              <>
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
                    нарушений у неразобранного дня - не заслуга, а пустота. */}
                {stats.marked > 0 && (
                  <Line
                    label={t.journal.weekBreaksLabel}
                    hint={t.journal.weekBreaksHint}
                    value={String(stats.breaks)}
                    mood={stats.breaks > 0 ? -1 : 0}
                  />
                )}
              </>
            )}
          </div>

          {/* Нарушения по вашим отметкам: какое правило ломается чаще прочих.
              Пока отметок нет - так и написано, а не нарисован ноль. */}
          <div className="rounded-lg border border-[var(--pane-border)] px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {t.journal.weekReviewMistakes}
            </span>
            {stats.marked === 0 ? (
              <p className="mt-1 text-[10px] text-[var(--pane-muted)]">
                {t.journal.weekReviewNoMarks}
              </p>
            ) : breaks.length === 0 ? (
              <p className="mt-1 text-[10px] text-[var(--pane-up)]">
                {t.journal.weekReviewClean}
              </p>
            ) : (
              <div className="mt-1">
                {breaks.slice(0, 4).map((one) => (
                  <Line
                    key={one.code}
                    label={
                      (t.journal.mistakes as Record<string, string>)[one.code] ?? one.code
                    }
                    value={String(one.count)}
                    mood={-1}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Что осталось разобрать: без этого раздел молчит о собственной
              работе - какие сделки ещё ждут отметки и снимков. */}
          <div className="rounded-lg border border-[var(--pane-border)] px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {t.journal.undoneTitle}
            </span>
            <div className="mt-1">
              <Line
                label={t.journal.undoneNoMark}
                value={String(undone.noMark.length)}
                mood={undone.noMark.length > 0 ? -1 : 0}
              />
              <Line
                label={t.journal.undoneNoShot}
                value={String(undone.noShot.length)}
                mood={undone.noShot.length > 0 ? -1 : 0}
              />
              {/* Первая неразобранная - в один щелчок: разбор начинают с неё. */}
              {undone.noMark.length > 0 && (
                <button
                  onClick={() => {
                    const first = [...undone.noMark].sort((a, b) => timeOf(a) - timeOf(b))[0];
                    if (first) onPick(first, numberOf(first));
                  }}
                  className="mt-1 w-full rounded border border-[var(--pane-border)] py-1 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
                >
                  {t.journal.undoneOpen}
                </button>
              )}
            </div>
          </div>

          {/* Сессии: где деньги делаются, а где отдаются. */}
          <div className="rounded-lg border border-[var(--pane-border)] px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {t.journal.weekReviewSessions}
            </span>
            {sessions.length === 0 ? (
              <p className="mt-1 text-[10px] text-[var(--pane-muted)]">{t.journal.weekEmpty}</p>
            ) : (
              <div className="mt-1">
                {sessions.map(([name, one]) => (
                  <Line
                    key={name}
                    label={`${t.journal.sessions[name]} · ${one.trades}`}
                    value={money(one.pnl)}
                    mood={one.pnl}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Карта торговли во всю ширину половины: по ней виден режим работы -
              где подряд, а где неделя тишины. Клетка открывает свой день. */}
          <div className="rounded-lg border border-[var(--pane-border)] sm:col-span-2">
            <ActivityHeat
              rows={rows}
              active={picked ?? undefined}
              onPick={(at) => {
                const one = String(at.getMonth() + 1).padStart(2, "0");
                const two = String(at.getDate()).padStart(2, "0");
                onPickDay(`${at.getFullYear()}-${one}-${two}`);
                setCoin(null);
              }}
            />

            <div className="border-t border-[var(--pane-border)] px-2 py-1.5">
              <button
                onClick={() => setSum(true)}
                className="w-full rounded border border-[var(--pane-border)] py-1 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
              >
                {t.journal.weekReviewMake}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--pane-border)] p-2">
          {/* Путь: по нему видно, что открыто, и им же выходят наверх. */}
          <div className="mb-1.5 flex items-baseline gap-1">
            {coin !== null && (
              <button
                onClick={() => setCoin(null)}
                className="inline-flex items-center gap-0.5 font-mono text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
              >
                <ChevronLeft className="h-3 w-3" />
                {t.journal.backToCoins}
              </button>
            )}
            <span className="font-mono text-[10px] font-bold text-[var(--pane-text)]">
              {picked
                ? new Date(`${picked}T12:00:00`).toLocaleDateString(numbers, {
                    day: "2-digit",
                    month: "short",
                  })
                : new Date(year, month - 1, 1).toLocaleDateString(numbers, {
                    month: "long",
                    year: "numeric",
                  })}
            </span>
            {coin !== null && (
              <>
                <span className="font-mono text-[10px] text-[var(--pane-border)]">/</span>
                <span className="font-mono text-[10px] font-bold text-[var(--pane-text)]">
                  {coin}
                </span>
              </>
            )}
            <div className="h-px flex-1 bg-[var(--pane-border)]" />
            <span className="text-[10px] text-[var(--pane-muted)]">
              {t.journal.shotsIn(
                here.reduce((count, one) => count + (one.shots?.length ?? 0), 0),
              )}
            </span>
          </div>

          {here.length === 0 ? (
            <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
              {t.journal.galleryEmpty}
            </p>
          ) : coin === null ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
            >
              {byCoin.map(([name, list]) => (
                <Folder
                  key={name}
                  name={name}
                  badge={t.journal.tradesIn(list.length)}
                  note={t.journal.shotsIn(
                    list.reduce((count, one) => count + (one.shots?.length ?? 0), 0),
                  )}
                  sum={list.reduce((count, one) => count + one.pnl, 0)}
                  cover={coverOf(list)}
                  mark={brokenIn(list)}
                  onOpen={() => {
                    setCoin(name);
                    setWide(false);
                  }}
                />
              ))}
            </div>
          ) : (
            <>
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
              >
                {(wide ? inCoin : inCoin.slice(0, PAGE)).map((trade) => {
                  const cover = (trade.shots ?? [])[0];
                  return (
                    <button
                      key={trade.client_id}
                      onClick={() => onPick(trade, numberOf(trade))}
                      className="group overflow-hidden rounded border border-[var(--pane-border)] text-left transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)]"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--pane-hover)]">
                        {cover && (
                          <img
                            src={shotImage(cover)}
                            alt={trade.symbol}
                            className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            loading="lazy"
                          />
                        )}
                        <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white/80">
                          {trade.shots?.length ?? 0}
                        </span>
                        {trade.plan_ok === false && (
                          <span className="absolute left-1 top-1 rounded bg-[var(--pane-down)] px-1 text-[9px] font-bold text-white">
                            !
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 px-1 py-0.5 text-[9px]">
                        <span className="font-mono text-[var(--pane-text-2)]">
                          {t.journal.positionNo(numberOf(trade))}
                        </span>
                        <span
                          className={
                            trade.side === "long"
                              ? "text-[var(--pane-up)]"
                              : "text-[var(--pane-down)]"
                          }
                        >
                          {trade.side === "long" ? t.journal.long : t.journal.short}
                        </span>
                        <div className="flex-1" />
                        <span className={`font-mono font-bold ${tone(trade.pnl)}`}>
                          {money(trade.pnl)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 px-1 pb-0.5 text-[9px] text-[var(--pane-muted)]">
                        <span>
                          {new Date(timeOf(trade)).toLocaleTimeString(numbers, {
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

              {inCoin.length > PAGE && (
                <button
                  onClick={() => setWide((was) => !was)}
                  className="mt-1 text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
                >
                  {wide ? t.journal.foldersLess : t.journal.foldersMore(inCoin.length - PAGE)}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Разбор недели остаётся недельным: сводка по одному дню - это сам
          день, а по месяцу её никто не читает. Берём неделю выбранного дня. */}
      {sum && (
        <WeekReviewCard
          rows={rows}
          week={isoWeek(picked ? new Date(`${picked}T12:00:00Z`) : new Date())}
          onClose={() => setSum(false)}
        />
      )}
    </div>
  );
}
