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
import { shotImage, type TradeShot } from "@/lib/journalShots";
import { isoWeek, loadPlan, savePlan } from "@/lib/weekPlan";
import type { JournalRow } from "./JournalTable";

export interface ReviewPanelProps {
  /** Строки журнала за период: и закрытые, и идущие. */
  rows: readonly JournalRow[];
  /** Нажали на снимок: открыть разбор этой сделки. */
  onPick: (trade: JournalRow, shot: TradeShot) => void;
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
        {folders.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
            {t.journal.galleryEmpty}
          </p>
        ) : (
          <div className="grid gap-2">
            {folders.map((trade) => (
              <section
                key={trade.client_id}
                className="overflow-hidden rounded-lg border border-[var(--pane-border)]"
              >
                {/* Шапка папки: чья это сделка и чем кончилась. Ровно те же
                    данные, что в строке списка, - разбор и список должны
                    читаться одинаково. */}
                <header className="flex items-center gap-2 border-b border-[var(--pane-border)] px-2 py-1">
                  <span className="font-mono text-[11px] font-bold text-[var(--pane-text)]">
                    {trade.symbol.replace(/USDT$/, "")}
                  </span>
                  <span
                    className={`text-[10px] ${
                      trade.side === "long"
                        ? "text-[var(--pane-up)]"
                        : "text-[var(--pane-down)]"
                    }`}
                  >
                    {trade.side === "long" ? t.journal.long : t.journal.short}
                  </span>
                  <span className="text-[10px] text-[var(--pane-muted)]">×{trade.leverage}</span>
                  {trade.targets.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      {trade.targets.map((_, i) => (
                        <span
                          key={i}
                          className={`text-[9px] ${
                            i < trade.takes_hit
                              ? "text-[var(--pane-up)]"
                              : "text-[var(--pane-muted)] opacity-50"
                          }`}
                        >
                          {i < trade.takes_hit ? "●" : "○"}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--pane-muted)]">
                    {new Date(trade.closed_at ?? trade.opened_at ?? "").toLocaleString(numbers, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-[10px] text-[var(--pane-muted)]">
                    {t.journal.shotsIn(trade.shots?.length ?? 0)}
                  </span>
                  <div className="flex-1" />
                  <span className={`font-mono text-[11px] font-bold ${tone(trade.pnl)}`}>
                    {/* У идущей сделки это зафиксированное целями, как и в
                        строке списка: точка говорит, что итог не окончателен. */}
                    {trade.closed_at === null && (
                      <span className="mr-1 text-[9px] opacity-60">●</span>
                    )}
                    {money(trade.pnl)}
                  </span>
                </header>

                <div className="grid grid-cols-2 gap-1.5 p-1.5 md:grid-cols-3 xl:grid-cols-4">
                  {(trade.shots ?? []).map((shot) => (
                    <figure
                      key={shot.id}
                      className="overflow-hidden rounded border border-[var(--pane-border)]"
                    >
                      <button onClick={() => onPick(trade, shot)} className="block w-full">
                        <img
                          src={shotImage(shot)}
                          alt={shot.note || trade.symbol}
                          className="block h-24 w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                      {/* Подпись - только своя: монета, время и итог стоят в
                          шапке папки, и повторять их под каждой картинкой
                          значит писать одно и то же по четыре раза. */}
                      {shot.note && (
                        <figcaption className="truncate px-1.5 py-0.5 text-[9px] text-[var(--pane-muted)]">
                          {shot.note}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
