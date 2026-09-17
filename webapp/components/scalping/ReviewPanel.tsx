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

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { shotImage } from "@/lib/journalShots";
import { isoWeek, loadPlan, savePlan } from "@/lib/weekPlan";
import type { JournalRow } from "./JournalTable";

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Нажали на папку: открыть позицию целиком. */
  onPick: (trade: JournalRow, number: number) => void;
}

export default function ReviewPanel({ rows, onPick }: ReviewPanelProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [plan, setPlan] = useState("");
  const [week, setWeek] = useState(() => isoWeek());
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Что уже записано на сервере: по нему видно, есть ли что сохранять.
  const kept = useRef("");

  useEffect(() => {
    let gone = false;
    void loadPlan().then((body) => {
      if (gone || !body) return;
      setPlan(body.text);
      setWeek(body.week);
      kept.current = body.text;
    });
    return () => {
      gone = true;
    };
  }, []);

  // Сохраняем не на каждую букву: план пишут абзацами, и запрос на каждое
  // нажатие клавиши - это десятки запросов на одну мысль.
  useEffect(() => {
    if (plan === kept.current) return;
    const id = setTimeout(async () => {
      setBusy(true);
      const done = await savePlan(plan, week);
      setBusy(false);
      if (done) {
        kept.current = done.text;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [plan, week]);

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
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex flex-col rounded-lg border border-[var(--pane-border)]">
        <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-2 py-1.5">
          <span className="text-[11px] font-semibold text-[var(--pane-text)]">
            {t.journal.planTitle}
          </span>
          <span className="text-[10px] text-[var(--pane-muted)]">{week}</span>
          <div className="flex-1" />
          {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--pane-muted)]" />}
          {saved && !busy && <Check className="h-3 w-3 text-[var(--pane-up)]" />}
        </div>
        <textarea
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          placeholder={t.journal.planHint}
          spellCheck={false}
          className="min-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[11px] leading-relaxed text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
        />
      </div>

      <div className="rounded-lg border border-[var(--pane-border)] p-2">
        {byCoin.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
            {t.journal.galleryEmpty}
          </p>
        ) : (
          <div className="grid gap-3">
            {byCoin.map(([coin, list]) => (
              <section key={coin}>
                <h3 className="mb-1.5 font-mono text-[11px] font-bold text-[var(--pane-text)]">
                  {coin}
                  <span className="ml-1.5 font-sans text-[10px] font-normal text-[var(--pane-muted)]">
                    {t.journal.shotsIn(
                      list.reduce((sum, one) => sum + (one.shots?.length ?? 0), 0),
                    )}
                  </span>
                </h3>

                {/* Папки квадратами, а не полосами во всю ширину: позиция это
                    одна вещь и выглядеть должна как одна вещь. Полосой во весь
                    экран одна сделка занимала столько же места, сколько целый
                    день работы. */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {list.map((trade) => {
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
                        <div className="flex items-center gap-1 px-1.5 py-1">
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
                        <div className="flex items-center gap-1 px-1.5 pb-1 text-[9px] text-[var(--pane-muted)]">
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
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
