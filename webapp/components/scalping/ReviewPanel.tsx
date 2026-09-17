"use client";

// Разбор: архив сделок. Год, месяц, день, монета, сделка.
//
// Разбирают именно так, сверху вниз: сперва вспоминают, какой был месяц,
// потом ищут день, потом монету, и только потом смотрят картинки одной
// позиции. Всё сразу на одном экране означало полсотни мелких плиток, между
// которыми глазу не за что зацепиться.
//
// Пустые дни в месяце не показываются. Тридцать одна плитка, из которых
// двадцать пустых, - это не архив, а календарь, а календарь в кабинете уже
// есть, и он про деньги, а не про картинки. Пустые месяцы, наоборот, на
// месте: год - это год, и дыра в нём говорит не меньше прибыльного месяца.
//
// Снимки берутся из тех же строк журнала, что и таблица: отдельного запроса
// нет, и разбор не может разойтись со списком сделок.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { shotImage } from "@/lib/journalShots";
import { isoWeek } from "@/lib/weekPlan";
import { dayKey } from "@/lib/activity";
import { sumUp } from "@/lib/weekStats";
import ActivityHeat from "./ActivityHeat";
import WeekReviewCard from "./WeekReviewCard";
import type { JournalRow } from "./JournalTable";

/** Сколько сделок монеты видно до раскрытия. */
const PAGE = 12;

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Нажали на папку: открыть позицию целиком. */
  onPick: (trade: JournalRow, number: number) => void;
}

/** Когда сделка случилась. Ноль - времени нет, в архив она не попадёт. */
function timeOf(row: JournalRow): number {
  const at = row.closed_at ?? row.opened_at;
  if (!at) return 0;
  const when = new Date(at).getTime();
  return Number.isNaN(when) ? 0 : when;
}

/** Строка таблицы: подпись слева, число справа, пунктир между ними. */
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

/** Папка архива: обложка, имя поверх неё, ярлык и итог снизу. */
function Folder({
  name,
  badge,
  note,
  sum,
  cover,
  mark,
  big,
  onOpen,
}: {
  name: string;
  badge?: string;
  note?: string;
  sum?: number;
  cover?: string;
  mark?: number;
  big?: boolean;
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
            className="h-full w-full object-cover opacity-60 transition duration-200 ease-out group-hover:scale-[1.03] group-hover:opacity-80 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
          />
        )}
        {/* Имя поверх обложки: папку узнают по нему, а не по картинке -
            графики у всех похожи. */}
        <span
          className={`absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 font-mono font-bold text-white ${
            big ? "text-[13px]" : "text-[12px]"
          }`}
        >
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

export default function ReviewPanel({ rows, onPick }: ReviewPanelProps) {
  const t = useT();
  const numbers = useIntlLocale();
  // Где стоим в архиве. Год есть всегда, дальше - по мере погружения.
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [coin, setCoin] = useState<string | null>(null);
  const [sum, setSum] = useState(false);
  const [wide, setWide] = useState(false);

  // Сделки с картинками: только они и попадают в разбор.
  const shots = useMemo(
    () => rows.filter((row) => (row.shots?.length ?? 0) > 0 && timeOf(row) > 0),
    [rows],
  );

  const inYear = useMemo(
    () => shots.filter((row) => new Date(timeOf(row)).getFullYear() === year),
    [shots, year],
  );
  const inMonth = useMemo(
    () =>
      month === null ? [] : inYear.filter((row) => new Date(timeOf(row)).getMonth() === month),
    [inYear, month],
  );
  const inDay = useMemo(
    () =>
      day === null ? [] : inMonth.filter((row) => new Date(timeOf(row)).getDate() === day),
    [inMonth, day],
  );

  /** Сделки по монетам того дня, где больше - выше. */
  const byCoin = useMemo(() => {
    const map = new Map<string, JournalRow[]>();
    for (const row of inDay) {
      const name = row.symbol.replace(/USDT$/, "");
      map.set(name, [...(map.get(name) ?? []), row]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [inDay]);

  const inCoin = useMemo(
    () => (coin === null ? [] : (byCoin.find(([name]) => name === coin)?.[1] ?? [])),
    [byCoin, coin],
  );

  // Номера позиций - сквозные по дню, от самой ранней. По ним позицию и
  // называют в разговоре: «посмотри вторую», а не «ту, что в 19:05».
  const numberOf = useMemo(() => {
    const order = [...inDay].sort((a, b) => timeOf(a) - timeOf(b));
    const map = new Map<string, number>();
    order.forEach((one, i) => map.set(one.client_id, i + 1));
    return (trade: JournalRow) => map.get(trade.client_id) ?? 0;
  }, [inDay]);

  // Цифры считаются за то, что открыто: день внутри дня, месяц внутри месяца.
  const here = day !== null ? inDay : month !== null ? inMonth : inYear;
  const stats = useMemo(() => sumUp(here.filter((row) => row.closed_at !== null)), [here]);

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Date(year, i, 1).toLocaleDateString(numbers, { month: "short" }),
      ),
    [year, numbers],
  );

  /** Обложка папки: первый снимок самой ранней сделки внутри неё. */
  function coverOf(list: readonly JournalRow[]): string | undefined {
    const first = [...list].sort((a, b) => timeOf(a) - timeOf(b))[0];
    const shot = (first?.shots ?? [])[0];
    return shot ? shotImage(shot) : undefined;
  }

  function sumOf(list: readonly JournalRow[]): number {
    return list.reduce((all, one) => all + one.pnl, 0);
  }

  function brokenIn(list: readonly JournalRow[]): number {
    return list.filter((one) => one.plan_ok === false).length;
  }

  /** Крошка пути: нажатие возвращает на этот уровень. */
  function Crumb({ text, onBack }: { text: string; onBack?: () => void }) {
    return (
      <>
        <span className="font-mono text-[10px] text-[var(--pane-border)]">/</span>
        {onBack ? (
          <button
            onClick={onBack}
            className="font-mono text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            {text}
          </button>
        ) : (
          <span className="font-mono text-[10px] font-bold text-[var(--pane-text)]">{text}</span>
        )}
      </>
    );
  }

  const cells = "repeat(auto-fill, minmax(150px, 1fr))";

  function toYear() {
    setMonth(null);
    setDay(null);
    setCoin(null);
  }

  return (
    <div className="grid items-start gap-2 lg:grid-cols-[minmax(200px,230px)_minmax(0,1fr)]">
      {/* Цифры того уровня, на котором стоим: подпись слева, число справа. */}
      <div className="rounded-lg border border-[var(--pane-border)]">
        <div className="flex items-center gap-1 border-b border-[var(--pane-border)] px-2 py-1.5">
          <button
            onClick={() => {
              setYear((was) => was - 1);
              toYear();
            }}
            title={t.journal.spanPrev}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="flex-1 text-center font-mono text-[11px] font-bold text-[var(--pane-text)]">
            {year}
          </span>
          <button
            onClick={() => {
              setYear((was) => was + 1);
              toYear();
            }}
            title={t.journal.spanNext}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-2 py-1.5">
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {day !== null
                ? t.journal.totalsDay
                : month !== null
                  ? t.journal.totalsMonth
                  : t.journal.totalsYear}
            </span>
            <div className="flex-1" />
            <span className={`font-mono text-[12px] font-bold ${tone(stats.pnl)}`}>
              {stats.trades > 0 ? money(stats.pnl) : "-"}
            </span>
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
                  нарушений у неразобранного куска - не заслуга, а пустота. */}
              {stats.marked > 0 && (
                <Line
                  label={t.journal.weekBreaksLabel}
                  hint={t.journal.weekBreaksHint}
                  value={String(stats.breaks)}
                  mood={stats.breaks > 0 ? -1 : 0}
                />
              )}

              <button
                onClick={() => setSum(true)}
                className="mt-1.5 w-full rounded border border-[var(--pane-border)] py-1 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
              >
                {t.journal.weekReviewMake}
              </button>
            </>
          )}
        </div>

        {/* Карта торговли: по ней видно режим работы и по ней же ходят.
            Нажали на клетку - архив открылся на этом дне. */}
        <ActivityHeat
          rows={rows}
          active={
            day !== null && month !== null
              ? dayKey(new Date(year, month, day))
              : undefined
          }
          onPick={(at) => {
            setYear(at.getFullYear());
            setMonth(at.getMonth());
            setDay(at.getDate());
            setCoin(null);
          }}
        />
      </div>

      <div className="rounded-lg border border-[var(--pane-border)] p-2">
        {/* Путь: по нему видно, где стоишь, и им же выходят наверх. */}
        <div className="mb-1.5 flex items-baseline gap-1">
          <button
            onClick={toYear}
            className="font-mono text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            {year}
          </button>
          {month !== null && (
            <Crumb
              text={monthNames[month]}
              onBack={
                day !== null
                  ? () => {
                      setDay(null);
                      setCoin(null);
                    }
                  : undefined
              }
            />
          )}
          {day !== null && (
            <Crumb text={String(day)} onBack={coin !== null ? () => setCoin(null) : undefined} />
          )}
          {coin !== null && <Crumb text={coin} />}
          <div className="h-px flex-1 bg-[var(--pane-border)]" />
        </div>

        {month === null ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: cells }}>
            {monthNames.map((name, i) => {
              const list = inYear.filter((row) => new Date(timeOf(row)).getMonth() === i);
              const days = new Set(list.map((row) => new Date(timeOf(row)).getDate())).size;
              return (
                <Folder
                  key={name}
                  big
                  name={name}
                  badge={list.length > 0 ? t.journal.tradesIn(list.length) : undefined}
                  note={days > 0 ? t.journal.daysIn(days) : t.journal.noTrades}
                  sum={list.length > 0 ? sumOf(list) : undefined}
                  cover={coverOf(list)}
                  mark={brokenIn(list)}
                  onOpen={() => {
                    setMonth(i);
                    setDay(null);
                    setCoin(null);
                  }}
                />
              );
            })}
          </div>
        ) : day === null ? (
          (() => {
            const byDay = new Map<number, JournalRow[]>();
            for (const row of inMonth) {
              const number = new Date(timeOf(row)).getDate();
              byDay.set(number, [...(byDay.get(number) ?? []), row]);
            }
            const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
            if (days.length === 0) {
              return (
                <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
                  {t.journal.galleryEmpty}
                </p>
              );
            }
            return (
              <div className="grid gap-2" style={{ gridTemplateColumns: cells }}>
                {days.map(([number, list]) => {
                  const coins = new Set(list.map((one) => one.symbol.replace(/USDT$/, "")));
                  return (
                    <Folder
                      key={number}
                      big
                      name={`${number} ${monthNames[month]}`}
                      badge={t.journal.tradesIn(list.length)}
                      note={t.journal.coinsIn(coins.size)}
                      sum={sumOf(list)}
                      cover={coverOf(list)}
                      mark={brokenIn(list)}
                      onOpen={() => {
                        setDay(number);
                        setCoin(null);
                      }}
                    />
                  );
                })}
              </div>
            );
          })()
        ) : coin === null ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: cells }}>
            {byCoin.map(([name, list]) => (
              <Folder
                key={name}
                name={name}
                badge={t.journal.tradesIn(list.length)}
                note={t.journal.shotsIn(
                  list.reduce((all, one) => all + (one.shots?.length ?? 0), 0),
                )}
                sum={sumOf(list)}
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
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
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

      {/* Разбор недели остаётся недельным: сводка по одному дню - это сам
          день, а по месяцу её никто не читает. Берём неделю того дня, в
          который смотрит архив. */}
      {sum && (
        <WeekReviewCard
          rows={rows}
          week={isoWeek(new Date(Date.UTC(year, month ?? 0, day ?? 1)))}
          onClose={() => setSum(false)}
        />
      )}
    </div>
  );
}
