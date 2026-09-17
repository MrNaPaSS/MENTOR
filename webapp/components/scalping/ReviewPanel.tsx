"use client";

// Разбор: неделя, монеты, сделки.
//
// Три уровня, потому что разбирают именно так: сперва вспоминают, чем была
// неделя по BTC, потом ищут в ней нужную позицию, и только потом смотрят её
// картинки. Всё сразу на одном экране означало полсотни мелких плиток, между
// которыми глазу не за что зацепиться.
//
// Сверху - неделя и её итог. План недели отсюда убран: он нужен раз в
// понедельник, а место занимал постоянно, и разбор упирался в него каждый
// раз, когда хотелось посмотреть картинки.
//
// Снимки собраны папками по сделкам, а не сплошной лентой. Лента врала глазу:
// два снимка одной сделки - вход и выход - стояли рядом как две разные сделки
// с одинаковым итогом, и складывалось впечатление, что заработано вдвое
// больше. Папка отвечает на это сразу: одна сделка, её данные, её картинки.
//
// Снимки берутся из тех же строк журнала, что и таблица: отдельного запроса
// нет, и разбор не может разойтись со списком сделок.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { shotImage } from "@/lib/journalShots";
import { isoWeek, weekRange, weekShift } from "@/lib/weekPlan";
import { weekStats } from "@/lib/weekStats";
import WeekReviewCard from "./WeekReviewCard";
import type { JournalRow } from "./JournalTable";

/**
 * Сколько папок видно до раскрытия.
 *
 * Полтора-два ряда - ровно та порция, которую глаз охватывает не прокручивая.
 * Монета с тремя десятками позиций иначе вытесняет с экрана все остальные, и
 * разбор недели превращается в разбор одной монеты.
 */
const PAGE = 12;

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Нажали на папку: открыть позицию целиком. */
  onPick: (trade: JournalRow, number: number) => void;
}

/** К какой неделе относится сделка: к той, в которую она закрылась. */
function weekOf(row: JournalRow): string {
  const at = row.closed_at ?? row.opened_at;
  if (!at) return "";
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? "" : isoWeek(when);
}

/** Чип итога: короткая подпись и число. */
function Chip({
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
    <span
      title={hint}
      className="inline-flex items-baseline gap-1 rounded bg-[var(--pane-hover)] px-1.5 py-0.5"
    >
      <span className="text-[10px] text-[var(--pane-muted)]">{label}</span>
      <span
        className={`font-mono text-[10px] ${
          mood === undefined || mood === 0
            ? "text-[var(--pane-text-2)]"
            : `font-bold ${tone(mood)}`
        }`}
      >
        {value}
      </span>
    </span>
  );
}

export default function ReviewPanel({ rows, onPick }: ReviewPanelProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [week, setWeek] = useState(() => isoWeek());
  // Открыт ли разбор недели: собирается по кнопке, сам не лезет.
  const [sum, setSum] = useState(false);
  // Открытая монета. Пусто - показываем полку монет.
  const [coin, setCoin] = useState<string | null>(null);
  // Монеты, раскрытые целиком. Остальные показывают первые PAGE папок.
  const [wide, setWide] = useState<readonly string[]>([]);

  // Сделки выбранной недели, у которых есть снимки: только они и попадают в
  // разбор. Неделю листают стрелками - журнал может отдавать месяц сразу.
  const folders = useMemo(
    () =>
      rows.filter((row) => (row.shots?.length ?? 0) > 0 && weekOf(row) === week),
    [rows, week],
  );

  const stats = useMemo(() => weekStats(rows, week), [rows, week]);

  // Номера позиций - сквозные по неделе, от самой ранней. По ним позицию и
  // называют в разговоре: «посмотри вторую», а не «ту, что в 19:05».
  const numberOf = useMemo(() => {
    const order = [...folders].sort((a, b) =>
      (a.opened_at ?? a.closed_at ?? "").localeCompare(b.opened_at ?? b.closed_at ?? ""),
    );
    const map = new Map<string, number>();
    order.forEach((one, i) => map.set(one.client_id, i + 1));
    return (trade: JournalRow) => map.get(trade.client_id) ?? 0;
  }, [folders]);

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

  const span = weekRange(week);
  const dates = span
    ? `${span.from.toLocaleDateString(numbers, {
        day: "2-digit",
        month: "short",
      })} - ${span.to.toLocaleDateString(numbers, { day: "2-digit", month: "short" })}`
    : "";

  return (
    <div className="flex flex-col gap-2">
      {/* Шапка: какая неделя, чем кончилась, и кнопка разбора. Одна строка на
          всё - разбор смотрят ради картинок, а не ради заголовка. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--pane-border)] px-2 py-1.5">
        <button
          onClick={() => setWeek((was) => weekShift(was, -1))}
          title={t.journal.weekPrev}
          className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[11px] font-bold text-[var(--pane-text)]">{week}</span>
        <button
          onClick={() => setWeek((was) => weekShift(was, 1))}
          title={t.journal.weekNext}
          className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-[var(--pane-muted)]">{dates}</span>
        {week !== isoWeek() && (
          <button
            onClick={() => setWeek(isoWeek())}
            className="rounded border border-[var(--pane-border)] px-1.5 py-0.5 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-text)]"
          >
            {t.journal.weekNow}
          </button>
        )}

        <div className="h-px flex-1 bg-[var(--pane-border)]" />

        {stats.trades > 0 && (
          <>
            <Chip
              label={t.journal.weekTradesLabel}
              hint={t.journal.weekTradesHint}
              value={`${stats.marked} / ${stats.trades}`}
            />
            {stats.gain !== null && (
              <Chip
                label={t.journal.weekGainLabel}
                hint={t.journal.weekGainHint}
                value={`${stats.gain > 0 ? "+" : ""}${stats.gain.toFixed(1)}%`}
                mood={stats.pnl}
              />
            )}
            <Chip
              label={t.journal.weekWinrateLabel}
              hint={t.journal.weekWinrateHint}
              value={`${Math.round((stats.winrate ?? 0) * 100)}%`}
            />
            {/* Нарушения показываются, только если их отмечали: ноль нарушений
                у неразобранной недели - не заслуга, а пустота. */}
            {stats.marked > 0 && (
              <Chip
                label={t.journal.weekBreaksLabel}
                hint={t.journal.weekBreaksHint}
                value={String(stats.breaks)}
                mood={stats.breaks > 0 ? -1 : 0}
              />
            )}
            <span className={`font-mono text-[12px] font-bold ${tone(stats.pnl)}`}>
              {money(stats.pnl)}
            </span>
            <button
              onClick={() => setSum(true)}
              className="rounded border border-[var(--pane-border)] px-1.5 py-0.5 text-[10px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
            >
              {t.journal.weekReviewMake}
            </button>
          </>
        )}
      </div>

      <div className="rounded-lg border border-[var(--pane-border)] p-2">
        {byCoin.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
            {t.journal.galleryEmpty}
          </p>
        ) : coin === null ? (
          // Полка монет. По ней вспоминают неделю: чем была BTC, чем ETH.
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
          >
            {byCoin.map(([name, list]) => {
              const sum = list.reduce((all, one) => all + one.pnl, 0);
              const cover = list.flatMap((one) => one.shots ?? [])[0];
              const broken = list.filter((one) => one.plan_ok === false).length;
              return (
                <button
                  key={name}
                  onClick={() => setCoin(name)}
                  className="group overflow-hidden rounded-lg border border-[var(--pane-border)] text-left transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)]"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--pane-hover)]">
                    {cover && (
                      <img
                        src={shotImage(cover)}
                        alt={name}
                        className="h-full w-full object-cover opacity-60 transition duration-200 ease-out group-hover:scale-[1.03] group-hover:opacity-80 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                        loading="lazy"
                      />
                    )}
                    {/* Название монеты поверх обложки: папку узнают по нему,
                        а не по картинке - графики у всех похожи. */}
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 font-mono text-[12px] font-bold text-white">
                      {name}
                    </span>
                    <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white/80">
                      {t.journal.tradesIn(list.length)}
                    </span>
                    {broken > 0 && (
                      <span className="absolute left-1 top-1 rounded bg-[var(--pane-down)] px-1 text-[9px] font-bold text-white">
                        {broken}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1 text-[9px]">
                    <span className="text-[var(--pane-muted)]">
                      {t.journal.shotsIn(
                        list.reduce((all, one) => all + (one.shots?.length ?? 0), 0),
                      )}
                    </span>
                    <div className="flex-1" />
                    <span className={`font-mono text-[10px] font-bold ${tone(sum)}`}>
                      {money(sum)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          (() => {
            const list = byCoin.find(([name]) => name === coin)?.[1] ?? [];
            const sum = list.reduce((all, one) => all + one.pnl, 0);
            const open = wide.includes(coin);
            return (
              <div>
                {/* Возврат к монетам - первой же кнопкой: заблудиться в трёх
                    уровнях легче всего там, где выхода не видно. */}
                <div className="mb-1.5 flex items-baseline gap-1.5">
                  <button
                    onClick={() => setCoin(null)}
                    className="inline-flex items-center gap-0.5 font-mono text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    {t.journal.backToCoins}
                  </button>
                  <span className="font-mono text-[10px] text-[var(--pane-border)]">/</span>
                  <h3 className="font-mono text-[11px] font-bold text-[var(--pane-text)]">
                    {coin}
                  </h3>
                  <span className="text-[10px] text-[var(--pane-muted)]">
                    {t.journal.positionsIn(list.length)} ·{" "}
                    {t.journal.shotsIn(
                      list.reduce((all, one) => all + (one.shots?.length ?? 0), 0),
                    )}
                  </span>
                  <div className="h-px flex-1 bg-[var(--pane-border)]" />
                  <span className={`font-mono text-[11px] font-bold ${tone(sum)}`}>
                    {money(sum)}
                  </span>
                </div>

                {/* Ширину ряда задаёт сама панель, а не ширина экрана: журнал
                    живёт в окне, которое тянут мышью, и брейкпоинты экрана про
                    него ничего не знают. */}
                <div
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))" }}
                >
                  {(open ? list : list.slice(0, PAGE)).map((trade) => {
                    const cover = (trade.shots ?? [])[0];
                    return (
                      <button
                        key={trade.client_id}
                        onClick={() => onPick(trade, numberOf(trade))}
                        className="group overflow-hidden rounded border border-[var(--pane-border)] text-left transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:bg-[var(--pane-hover)]"
                      >
                        {/* Обложка - первый снимок папки: по нему её узнают
                            среди прочих, как книгу по корешку. */}
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
                          {/* Нарушение видно прямо на папке: разбор недели
                              начинают с того, где не удержались. */}
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
                            {new Date(
                              trade.closed_at ?? trade.opened_at ?? "",
                            ).toLocaleTimeString(numbers, {
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
                    {open ? t.journal.foldersLess : t.journal.foldersMore(list.length - PAGE)}
                  </button>
                )}
              </div>
            );
          })()
        )}
      </div>

      {sum && <WeekReviewCard rows={rows} week={week} onClose={() => setSum(false)} />}
    </div>
  );
}
