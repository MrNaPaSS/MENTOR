"use client";

// Позиция целиком: цифры сделки, снимки по этапам и разбор словами.
//
// Это то, ради чего журнал ведут. Строка списка отвечает «сколько», а здесь
// видно «как»: где был вход и стоп, во сколько раз риск меньше цели, в какую
// сессию торговали, что происходило на графике до входа, на входе, в ведении
// и на выходе, и что об этом думает сам трейдер.
//
// Снимки раскладываются по этапам сами - тот, что сделал терминал, знает свой
// этап, - а руками добавляются «до входа» и «разбор».

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import {
  MISTAKES,
  STAGES,
  attachShot,
  detachShot,
  pastedImage,
  readImage,
  saveReview,
  shotImage,
  type ShotStage,
  type TradeShot,
} from "@/lib/journalShots";
import ModalPortal from "@/components/ui/ModalPortal";
import type { JournalRow } from "./JournalTable";

export interface PositionCardProps {
  trade: JournalRow;
  /** Номер позиции в неделе: по нему её и называют в разговоре. */
  number?: number;
  onClose: () => void;
  /** Что-то изменилось: журнал перечитывает строки. */
  onChange: () => void;
}

/** Торговая сессия по часу входа: по ней видно, где результат лучше. */
export function sessionOf(at: string | null): "asia" | "london" | "newYork" | "evening" {
  const hour = at ? new Date(at).getUTCHours() : 0;
  if (hour < 7) return "asia";
  if (hour < 12) return "london";
  if (hour < 17) return "newYork";
  return "evening";
}

/** Во сколько раз задуманная цель дальше стопа. Ноль - считать не из чего. */
export function riskReward(trade: {
  entry: number;
  stop: number;
  targets: number[];
}): number {
  const risk = Math.abs(trade.entry - trade.stop);
  const far = trade.targets.at(-1);
  if (!(risk > 0) || far === undefined) return 0;
  return Math.abs(far - trade.entry) / risk;
}

export default function PositionCard({
  trade,
  number,
  onClose,
  onChange,
}: PositionCardProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(trade.review ?? "");
  const [stage, setStage] = useState<ShotStage>("before");
  const fileRef = useRef<HTMLInputElement>(null);
  const kept = useRef(trade.review ?? "");

  // Разбор сохраняется сам, через паузу: его пишут абзацами, и запрос на
  // каждую клавишу - это десятки запросов на одну мысль.
  useEffect(() => {
    if (review === kept.current) return;
    const id = setTimeout(async () => {
      setBusy(true);
      const done = await saveReview(trade.client_id, { review });
      setBusy(false);
      if (done) {
        kept.current = review;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        onChange();
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [review, trade.client_id, onChange]);

  // Вставка из буфера кладёт снимок в выбранный сейчас этап.
  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      const image = await pastedImage(event);
      if (!image) return;
      event.preventDefault();
      await add(image);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trade.client_id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function add(image: string | null) {
    if (!image) return;
    setBusy(true);
    const done = await attachShot(trade.client_id, image, "", stage);
    setBusy(false);
    if (done) onChange();
  }

  async function mark(plan: boolean | null) {
    if (await saveReview(trade.client_id, { plan_ok: plan })) onChange();
  }

  async function toggleMistake(code: string) {
    const have = new Set(trade.mistakes ?? []);
    if (have.has(code)) have.delete(code);
    else have.add(code);
    if (await saveReview(trade.client_id, { mistakes: [...have] })) onChange();
  }

  const rr = riskReward(trade);
  const shots = trade.shots ?? [];
  const at = trade.closed_at ?? trade.opened_at ?? null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (file) await add(await readImage(file));
          }}
          className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
            <span className="font-mono text-[12px] font-bold text-[var(--pane-text)]">
              {trade.symbol.replace(/USDT$/, "")}
            </span>
            <span
              className={`text-[11px] ${
                trade.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {trade.side === "long" ? t.journal.long : t.journal.short}
            </span>
            {number !== undefined && (
              <span className="text-[10px] text-[var(--pane-muted)]">
                {t.journal.positionNo(number)}
              </span>
            )}
            <span className="text-[10px] text-[var(--pane-muted)]">
              {at
                ? new Date(at).toLocaleString(numbers, {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </span>
            <div className="flex-1" />
            {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--pane-muted)]" />}
            {saved && !busy && <Check className="h-3 w-3 text-[var(--pane-up)]" />}
            <span className={`font-mono text-[13px] font-bold ${tone(trade.pnl)}`}>
              {money(trade.pnl)}
            </span>
            <button
              onClick={onClose}
              title={t.journal.close}
              className="ml-1 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="no-scrollbar flex-1 overflow-auto p-3">
            {/* Цифры сделки: замысел и то, чем он кончился. Всё это уже есть
                в журнале - здесь оно просто собрано в одном месте. */}
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
              <Fact label={t.journal.colEntry} value={String(trade.entry)} />
              <Fact label={t.journal.cardStop} value={String(trade.stop)} />
              <Fact
                label={t.journal.cardTargets}
                value={trade.targets.length > 0 ? trade.targets.join(" · ") : "-"}
              />
              <Fact
                label={t.journal.cardRR}
                value={rr > 0 ? `1 : ${rr.toFixed(1)}` : "-"}
              />
              <Fact label={t.journal.cardQty} value={String(trade.qty)} />
              <Fact label={t.journal.cardLeverage} value={`×${trade.leverage}`} />
              <Fact
                label={t.journal.cardSession}
                value={t.journal.sessions[sessionOf(trade.opened_at)]}
              />
              <Fact
                label={t.journal.cardFee}
                value={trade.fee > 0 ? `-${trade.fee.toFixed(2)}` : "-"}
              />
            </div>

            {/* Снимки по этапам: пустой этап тоже показываем - по нему видно,
                чего в разборе не хватает. */}
            <div className="grid gap-2">
              {STAGES.map((one) => {
                const mine = shots.filter((shot) => (shot.stage || "") === one);
                return (
                  <div key={one}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--pane-muted)]">
                        {t.journal.stages[one]}
                      </span>
                      <button
                        onClick={() => {
                          setStage(one);
                          fileRef.current?.click();
                        }}
                        title={t.journal.stageAdd}
                        className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    {mine.length === 0 ? (
                      <div className="rounded border border-dashed border-[var(--pane-border)] px-2 py-3 text-center text-[10px] text-[var(--pane-muted)]">
                        {t.journal.stageEmpty}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
                        {mine.map((shot) => (
                          <figure
                            key={shot.id}
                            className="group relative overflow-hidden rounded border border-[var(--pane-border)]"
                          >
                            <a
                              href={shotImage(shot)}
                              target="_blank"
                              rel="noreferrer"
                              className="block"
                            >
                              <img
                                src={shotImage(shot)}
                                alt={shot.note || trade.symbol}
                                className="block h-24 w-full object-cover"
                                loading="lazy"
                              />
                            </a>
                            <button
                              onClick={async () => {
                                if (await detachShot(shot.id)) onChange();
                              }}
                              title={t.journal.shotRemove}
                              className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white/70 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 hover:text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) await add(await readImage(file));
              }}
            />

            {/* Дисциплина: отмечает человек, потому что система видит цифры, а
                не намерение. Без отметки процент дисциплины был бы выдумкой. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--pane-muted)]">
                {t.journal.planMark}
              </span>
              <Chip
                on={trade.plan_ok === true}
                tone="up"
                onClick={() => mark(trade.plan_ok === true ? null : true)}
              >
                {t.journal.planKept}
              </Chip>
              <Chip
                on={trade.plan_ok === false}
                tone="down"
                onClick={() => mark(trade.plan_ok === false ? null : false)}
              >
                {t.journal.planBroken}
              </Chip>
              {trade.plan_ok === false &&
                MISTAKES.map((code) => (
                  <Chip
                    key={code}
                    on={(trade.mistakes ?? []).includes(code)}
                    tone="down"
                    onClick={() => toggleMistake(code)}
                  >
                    {t.journal.mistakes[code]}
                  </Chip>
                ))}
            </div>

            <textarea
              value={review}
              onChange={(event) => setReview(event.target.value)}
              placeholder={t.journal.reviewHint}
              spellCheck={false}
              className="mt-2 min-h-24 w-full resize-none rounded border border-[var(--pane-border)] bg-transparent px-2 py-1.5 text-[11px] leading-relaxed text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--pane-border)] pb-0.5">
      <span className="text-[10px] font-sans text-[var(--pane-muted)]">{label}</span>
      <span className="truncate text-[var(--pane-text-2)]">{value}</span>
    </div>
  );
}

function Chip({
  on,
  tone: kind,
  onClick,
  children,
}: {
  on: boolean;
  tone: "up" | "down";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = kind === "up" ? "var(--pane-up)" : "var(--pane-down)";
  return (
    <button
      onClick={onClick}
      className="rounded border px-1.5 py-0.5 text-[10px] transition-colors duration-150 ease-out"
      style={{
        borderColor: on ? color : "var(--pane-border)",
        color: on ? color : "var(--pane-muted)",
        background: on ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}
