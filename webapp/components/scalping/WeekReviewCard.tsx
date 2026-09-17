"use client";

// Разбор недели одним экраном.
//
// Собирается из того, что уже записано: сделки, отметки «по плану», время
// входа. Ничего нового трейдер не заполняет - в этом и смысл кнопки: разбор,
// который надо писать руками с нуля, не пишут вовсе.
//
// Тон сводки - протокол, а не приговор. Здесь не сказано «вечером торгуешь
// плохо»; здесь написано, сколько было сделок вечером и каким вышел итог. Что
// с этим делать, решает человек: это его деньги и его правила.

import { useEffect, useMemo, useState } from "react";
import { Copy, X } from "lucide-react";

import ModalPortal from "@/components/ui/ModalPortal";
import { useT, type Dict } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { heldLabel } from "@/lib/tradeTime";
import { weekReview, type WeekReview } from "@/lib/weekReview";
import type { JournalRow } from "./JournalTable";

export interface WeekReviewCardProps {
  rows: readonly JournalRow[];
  week: string;
  onClose: () => void;
}

/** Название нарушения словами. Незнакомый код показываем как есть. */
export function mistakeName(code: string, t: Dict): string {
  const names = t.journal.mistakes as Record<string, string>;
  return names[code] ?? code;
}

/** Сводка обычным текстом: её уносят в заметки, в мессенджер, ментору. */
export function reviewText(review: WeekReview, t: Dict): string {
  const { stats } = review;
  const coin = (symbol: string) => symbol.replace(/USDT$/, "");
  const rate = (wins: number, all: number) =>
    t.journal.weekWinrate(`${Math.round((wins / Math.max(all, 1)) * 100)}%`);

  const lines: string[] = [t.journal.weekReviewTitle(review.week), ""];

  lines.push(
    `${t.journal.weekReviewTotals}: ${t.journal.weekReviewTrades(stats.trades)}, ` +
      `${money(stats.pnl)}, ${rate(stats.wins, stats.trades)}, ` +
      t.journal.weekTrades(stats.marked, stats.trades),
  );
  if (review.best) {
    lines.push(
      `${t.journal.weekReviewBest}: ${coin(review.best.symbol)} ${money(review.best.pnl)}`,
    );
  }
  if (review.worst && review.worst !== review.best) {
    lines.push(
      `${t.journal.weekReviewWorst}: ${coin(review.worst.symbol)} ${money(review.worst.pnl)}`,
    );
  }

  if (review.held > 0) {
    lines.push(
      `${t.journal.weekReviewHeld}: ${heldLabel(review.held, t.journal.heldUnits)}`,
    );
  }

  lines.push("", `${t.journal.weekReviewMistakes}:`);
  if (stats.marked === 0) {
    lines.push(`- ${t.journal.weekReviewNoMarks}`);
  } else if (review.mistakes.length === 0) {
    lines.push(`- ${t.journal.weekReviewClean}`);
  } else {
    for (const one of review.mistakes) {
      lines.push(`- ${mistakeName(one.code, t)}: ${one.count}`);
    }
  }

  lines.push("", `${t.journal.weekReviewSessions}:`);
  for (const one of review.sessions) {
    lines.push(
      `- ${t.journal.sessions[one.name]}: ${t.journal.weekReviewTrades(one.trades)}, ` +
        `${money(one.pnl)}, ${rate(one.wins, one.trades)}`,
    );
  }

  lines.push("", `${t.journal.weekReviewAfterLoss}:`);
  lines.push(
    review.revenge.trades === 0
      ? `- ${t.journal.weekReviewAfterLossNone(review.revenge.minutes)}`
      : `- ${t.journal.weekReviewAfterLossLine(
          review.revenge.trades,
          review.revenge.minutes,
        )}, ${money(review.revenge.pnl)}`,
  );

  return lines.join("\n");
}

function Row({ label, value, mood }: { label: string; value: string; mood?: number }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-[10px] text-[var(--pane-muted)]">{label}</span>
      <div className="flex-1 border-b border-dashed border-[var(--pane-border)]" />
      <span
        className={`font-mono text-[11px] ${
          mood === undefined ? "text-[var(--pane-text)]" : `font-bold ${tone(mood)}`
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function WeekReviewCard({ rows, week, onClose }: WeekReviewCardProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const review = useMemo(() => weekReview(rows, week), [rows, week]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reviewText(review, t));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Браузер не дал буфер: текст всё равно на экране, и его можно выделить
      // руками. Ронять окно из-за этого незачем.
    }
  }

  const { stats } = review;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
            <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
              {t.journal.weekReviewTitle(week)}
            </h2>
            <div className="flex-1" />
            {copied && (
              <span className="text-[10px] text-[var(--pane-up)]">
                {t.journal.weekReviewCopied}
              </span>
            )}
            <button
              onClick={copy}
              title={t.journal.weekReviewCopy}
              className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              title={t.journal.close}
              className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-auto px-3 py-2">
            {stats.trades === 0 ? (
              <p className="py-8 text-center text-[11px] text-[var(--pane-muted)]">
                {t.journal.weekReviewEmpty}
              </p>
            ) : (
              <div className="grid gap-3">
                <section>
                  <h3 className="mb-1 text-[11px] font-semibold text-[var(--pane-text)]">
                    {t.journal.weekReviewTotals}
                  </h3>
                  <Row
                    label={t.journal.weekReviewTrades(stats.trades)}
                    value={money(stats.pnl)}
                    mood={stats.pnl}
                  />
                  <Row
                    label={t.journal.weekWinrate(
                      `${Math.round((stats.winrate ?? 0) * 100)}%`,
                    )}
                    value={t.journal.weekTrades(stats.marked, stats.trades)}
                  />
                  {review.held > 0 && (
                    <Row
                      label={t.journal.weekReviewHeld}
                      value={heldLabel(review.held, t.journal.heldUnits)}
                    />
                  )}
                  {review.best && (
                    <Row
                      label={t.journal.weekReviewBest}
                      value={`${review.best.symbol.replace(/USDT$/, "")} ${money(
                        review.best.pnl,
                      )}`}
                      mood={review.best.pnl}
                    />
                  )}
                  {review.worst && review.worst !== review.best && (
                    <Row
                      label={t.journal.weekReviewWorst}
                      value={`${review.worst.symbol.replace(/USDT$/, "")} ${money(
                        review.worst.pnl,
                      )}`}
                      mood={review.worst.pnl}
                    />
                  )}
                </section>

                <section>
                  <h3 className="mb-1 text-[11px] font-semibold text-[var(--pane-text)]">
                    {t.journal.weekReviewMistakes}
                  </h3>
                  {stats.marked === 0 ? (
                    <p className="text-[10px] text-[var(--pane-muted)]">
                      {t.journal.weekReviewNoMarks}
                    </p>
                  ) : review.mistakes.length === 0 ? (
                    <p className="text-[10px] text-[var(--pane-up)]">
                      {t.journal.weekReviewClean}
                    </p>
                  ) : (
                    review.mistakes.map((one) => (
                      <Row
                        key={one.code}
                        label={mistakeName(one.code, t)}
                        value={String(one.count)}
                      />
                    ))
                  )}
                </section>

                <section>
                  <h3 className="mb-1 text-[11px] font-semibold text-[var(--pane-text)]">
                    {t.journal.weekReviewSessions}
                  </h3>
                  {review.sessions.map((one) => (
                    <Row
                      key={one.name}
                      label={`${t.journal.sessions[one.name]} · ${t.journal.weekReviewTrades(
                        one.trades,
                      )}`}
                      value={money(one.pnl)}
                      mood={one.pnl}
                    />
                  ))}
                </section>

                <section>
                  <h3 className="mb-1 text-[11px] font-semibold text-[var(--pane-text)]">
                    {t.journal.weekReviewAfterLoss}
                  </h3>
                  {review.revenge.trades === 0 ? (
                    <p className="text-[10px] text-[var(--pane-muted)]">
                      {t.journal.weekReviewAfterLossNone(review.revenge.minutes)}
                    </p>
                  ) : (
                    <Row
                      label={t.journal.weekReviewAfterLossLine(
                        review.revenge.trades,
                        review.revenge.minutes,
                      )}
                      value={money(review.revenge.pnl)}
                      mood={review.revenge.pnl}
                    />
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
